(function initSignSafeBackgroundAnalysis(root) {
  const globalRoot = root || globalThis;
  const shared = globalRoot.SIGNSAFE_SHARED || (globalRoot.SIGNSAFE_SHARED = {});

  shared.createBackgroundAnalysisService = function createBackgroundAnalysisService(config) {
    const verdictCache = new Map();
    let envLocalApiKeyPromise = null;

    const rpcEndpoint = config.rpcEndpoint;
    const openaiApi = config.openaiApi;
    const openaiModel = config.openaiModel;
    const largeSolTransferThreshold = config.largeSolTransferThreshold;
    const verdictCacheTtlMs = config.verdictCacheTtlMs;
    const knownPrograms = config.knownPrograms || {};
    const storageKeys = config.storageKeys || {};
    const debugLog = typeof config.debugLog === "function" ? config.debugLog : () => {};

    return {
      analyzeTransaction,
      buildReviewVerdict,
      buildFallbackFacts
    };

    async function analyzeTransaction(base64Tx, context) {
      if (!base64Tx || typeof base64Tx !== "string" || base64Tx.trim() === "") {
        debugLog("empty or invalid transaction payload", context?.method);
        return buildReviewVerdict(
          "Could not analyze this transaction because it could not be serialized.",
          buildFallbackFacts(context),
          ["serialization_failed"]
        );
      }

      const cached = getCachedVerdict(base64Tx);
      if (cached) {
        debugLog("cache hit", context?.method);
        return cached;
      }

      try {
        debugLog("simulate start", context?.method);
        const simulation = await simulateTransaction(base64Tx);
        debugLog("simulate complete", context?.method);
        const parsed = parseSimulation(simulation, context);
        const heuristics = evaluateRisk(parsed);

        let verdict = heuristics.baseVerdict;
        if (shouldAskModel(heuristics)) {
          debugLog("openai start", context?.method);
          const modelVerdict = await askOpenAI(parsed, heuristics);
          verdict = mergeVerdicts(heuristics, modelVerdict);
          debugLog("openai complete", context?.method, verdict?.risk);
        }

        setCachedVerdict(base64Tx, verdict);
        return verdict;
      } catch (error) {
        debugLog("analysis failed", context?.method, error.message);
        return buildReviewVerdict(
          "Could not fully analyze this transaction. Proceed with caution.",
          buildFallbackFacts(context),
          ["analysis_error"],
          { riskReasons: [`Analysis error: ${error.message}`], interceptedMethod: context?.method || "signTransaction" }
        );
      }
    }

    async function simulateTransaction(base64Tx) {
      const data = await fetchJson(
        rpcEndpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "simulateTransaction",
            params: [
              base64Tx,
              {
                encoding: "base64",
                commitment: "processed",
                replaceRecentBlockhash: true,
                sigVerify: false
              }
            ]
          })
        },
        12000
      );

      if (data?.error?.message) {
        throw new Error(data.error.message);
      }

      return data?.result;
    }

    function parseSimulation(simulation, context) {
      const value = simulation?.value || {};
      const preBalances = Array.isArray(value.preBalances) ? value.preBalances : [];
      const postBalances = Array.isArray(value.postBalances) ? value.postBalances : [];
      const logs = Array.isArray(value.logs) ? value.logs : [];
      const programs = extractProgramsFromLogs(logs);

      const solChanges = preBalances
        .map((pre, index) => {
          const post = postBalances[index] || 0;
          const deltaLamports = post - pre;
          return {
            accountIndex: index,
            deltaLamports,
            deltaSol: Number((deltaLamports / 1e9).toFixed(9)),
            direction: deltaLamports > 0 ? "in" : "out"
          };
        })
        .filter((entry) => entry.deltaLamports !== 0);

      const preTokenBalances = Array.isArray(value.preTokenBalances) ? value.preTokenBalances : [];
      const postTokenBalances = Array.isArray(value.postTokenBalances) ? value.postTokenBalances : [];
      const tokenIndex = new Map();

      for (const entry of [...preTokenBalances, ...postTokenBalances]) {
        const key = `${entry.accountIndex}:${entry.mint}:${entry.owner || ""}`;
        if (!tokenIndex.has(key)) {
          tokenIndex.set(key, {
            accountIndex: entry.accountIndex,
            mint: entry.mint,
            owner: entry.owner || "",
            preAmount: 0,
            postAmount: 0
          });
        }
      }

      for (const entry of preTokenBalances) {
        const key = `${entry.accountIndex}:${entry.mint}:${entry.owner || ""}`;
        tokenIndex.get(key).preAmount = Number(entry?.uiTokenAmount?.uiAmountString || "0");
      }

      for (const entry of postTokenBalances) {
        const key = `${entry.accountIndex}:${entry.mint}:${entry.owner || ""}`;
        tokenIndex.get(key).postAmount = Number(entry?.uiTokenAmount?.uiAmountString || "0");
      }

      const tokenChanges = Array.from(tokenIndex.values())
        .map((entry) => ({
          ...entry,
          delta: Number((entry.postAmount - entry.preAmount).toFixed(9)),
          direction: entry.postAmount - entry.preAmount > 0 ? "in" : "out"
        }))
        .filter((entry) => entry.delta !== 0);

      return {
        sourceUrl: context?.sourceUrl || "",
        method: context?.method || "signTransaction",
        error: value.err || null,
        unitsConsumed: value.unitsConsumed ?? null,
        logs,
        programs: programs.map((programId) => ({
          programId,
          label: knownPrograms[programId] || null,
          known: Boolean(knownPrograms[programId])
        })),
        solChanges,
        tokenChanges,
        simulationStatus: value.err ? "failed" : "succeeded"
      };
    }

    function extractProgramsFromLogs(logs) {
      const seen = new Set();

      for (const line of logs) {
        const match = /^Program (\w+) invoke/.exec(line);
        if (match) {
          seen.add(match[1]);
        }
      }

      return Array.from(seen);
    }

    function evaluateRisk(parsed) {
      const facts = buildFacts(parsed);
      const reasonCodes = [];
      const riskReasons = [];
      const actions = buildHumanActions(parsed, facts);
      const warnings = facts.warnings.slice();
      let risk = parsed.simulationStatus === "failed" ? "danger" : "safe";

      if (parsed.simulationStatus === "failed") {
        addReason(reasonCodes, riskReasons, "simulation_failed", "Simulation failed, so transaction effects are uncertain.");
      }

      if (facts.totalSolOut >= largeSolTransferThreshold) {
        risk = maxRisk(risk, "review");
        addReason(reasonCodes, riskReasons, "large_transfer", `More than ${largeSolTransferThreshold} SOL leaves the wallet.`);
      }

      if (facts.totalTokenOut > 0 && facts.totalTokenIn === 0) {
        risk = maxRisk(risk, "danger");
        addReason(reasonCodes, riskReasons, "token_drain_pattern", "Tokens leave the wallet without an obvious incoming asset.");
      }

      if (facts.transferCount >= 3) {
        risk = maxRisk(risk, "review");
        addReason(reasonCodes, riskReasons, "multi_transfer_batch", "Multiple balance-changing operations happen in one request.");
      }

      if (facts.unknownPrograms.length > 0) {
        risk = maxRisk(risk, "review");
        addReason(reasonCodes, riskReasons, "unknown_program", "The transaction touches programs that are not in the current known-safe set.");
      }

      if (facts.totalSolOut > 0 && facts.totalTokenIn === 0 && facts.totalTokenOut === 0) {
        risk = maxRisk(risk, "review");
        addReason(reasonCodes, riskReasons, "sol_outflow", "SOL leaves the wallet without a matching token inflow.");
      }

      if (facts.message_preview) {
        risk = maxRisk(risk, "review");
        addReason(reasonCodes, riskReasons, "raw_message_signature", "A raw message signature cannot be simulated on-chain.");
      }

      const summary = buildHeuristicSummary(parsed, facts, reasonCodes);
      const verdict = buildVerdictLine(risk, reasonCodes);
      const source = shouldAskModel({ parsed, facts, reasonCodes, risk }) ? "heuristics+model" : "heuristics";

      return {
        parsed,
        facts,
        reasonCodes,
        riskReasons,
        actions,
        warnings,
        risk,
        source,
        baseVerdict: {
          risk,
          summary,
          actions,
          risk_reasons: dedupeStrings([...riskReasons, ...warnings]),
          verdict,
          reason_codes: reasonCodes.slice(),
          source,
          simulation_status: parsed.simulationStatus,
          intercepted_method: parsed.method,
          facts
        }
      };
    }

    function buildFacts(parsed) {
      const solFacts = parsed.solChanges.map((change) => ({
        account: `#${change.accountIndex}`,
        deltaSol: change.deltaSol,
        direction: change.direction
      }));

      const tokenFacts = parsed.tokenChanges.map((change) => ({
        mint: shorten(change.mint),
        owner: change.owner ? shorten(change.owner) : "",
        delta: change.delta,
        direction: change.direction
      }));

      const totalSolOut = parsed.solChanges
        .filter((change) => change.deltaLamports < 0)
        .reduce((sum, change) => sum + Math.abs(change.deltaSol), 0);
      const totalSolIn = parsed.solChanges
        .filter((change) => change.deltaLamports > 0)
        .reduce((sum, change) => sum + Math.abs(change.deltaSol), 0);
      const totalTokenOut = parsed.tokenChanges
        .filter((change) => change.delta < 0)
        .reduce((sum, change) => sum + Math.abs(change.delta), 0);
      const totalTokenIn = parsed.tokenChanges
        .filter((change) => change.delta > 0)
        .reduce((sum, change) => sum + Math.abs(change.delta), 0);
      const knownProgramLabels = parsed.programs
        .filter((program) => program.known)
        .map((program) => program.label || shorten(program.programId));
      const unknownPrograms = parsed.programs.filter((program) => !program.known).map((program) => program.programId);
      const warnings = [];

      if (parsed.unitsConsumed != null) {
        warnings.push(`Simulation consumed ${parsed.unitsConsumed} compute units.`);
      }

      return {
        sol_changes: solFacts,
        token_changes: tokenFacts,
        programs: parsed.programs.map((program) => program.label || shorten(program.programId)),
        total_sol_out: Number(totalSolOut.toFixed(9)),
        total_sol_in: Number(totalSolIn.toFixed(9)),
        total_token_out: Number(totalTokenOut.toFixed(9)),
        total_token_in: Number(totalTokenIn.toFixed(9)),
        totalSolOut: Number(totalSolOut.toFixed(9)),
        totalSolIn: Number(totalSolIn.toFixed(9)),
        totalTokenOut: Number(totalTokenOut.toFixed(9)),
        totalTokenIn: Number(totalTokenIn.toFixed(9)),
        transferCount: parsed.solChanges.length + parsed.tokenChanges.length,
        knownPrograms: knownProgramLabels,
        unknownPrograms,
        warnings,
        rawMessagePreview: null,
        message_preview: ""
      };
    }

    async function askOpenAI(parsed, heuristics) {
      const apiKey = await getApiKey();

      if (!apiKey) {
        debugLog("missing openai api key");
        return {
          summary: heuristics.baseVerdict.summary,
          actions: heuristics.baseVerdict.actions,
          risk_reasons: heuristics.baseVerdict.risk_reasons,
          verdict: heuristics.baseVerdict.verdict,
          source: "heuristics"
        };
      }

      const prompt = [
        "You are a Solana transaction security explainer.",
        "Use the deterministic facts and reason codes below to explain the transaction to a user.",
        "Do not invent new facts. Be conservative.",
        "Return only raw JSON with keys: summary, actions, risk_reasons, verdict.",
        "",
        "Structured facts:",
        JSON.stringify(
          {
            intercepted_method: parsed.method,
            simulation_status: parsed.simulationStatus,
            reason_codes: heuristics.reasonCodes,
            facts: heuristics.facts,
            heuristics_risk: heuristics.risk,
            heuristic_risk_reasons: heuristics.riskReasons,
            source_url: parsed.sourceUrl
          },
          null,
          2
        )
      ].join("\n");

      const data = await fetchJson(
        openaiApi,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: openaiModel,
            reasoning: { effort: "medium" },
            input: prompt,
            max_output_tokens: 500
          })
        },
        15000
      );

      if (data?.status === "incomplete") {
        debugLog("openai incomplete response");
        return {
          summary: heuristics.baseVerdict.summary,
          actions: heuristics.baseVerdict.actions,
          risk_reasons: heuristics.baseVerdict.risk_reasons,
          verdict: heuristics.baseVerdict.verdict,
          source: "heuristics"
        };
      }

      const rawText = extractOpenAIText(data);
      const sanitized = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();

      try {
        return JSON.parse(sanitized);
      } catch (_error) {
        debugLog("failed to parse openai response");
        return {
          summary: heuristics.baseVerdict.summary,
          actions: heuristics.baseVerdict.actions,
          risk_reasons: heuristics.baseVerdict.risk_reasons,
          verdict: heuristics.baseVerdict.verdict,
          source: "heuristics"
        };
      }
    }

    function mergeVerdicts(heuristics, modelVerdict) {
      const base = heuristics.baseVerdict;

      return {
        risk: base.risk,
        summary: safeString(modelVerdict?.summary) || base.summary,
        actions: normalizeStringArray(modelVerdict?.actions, base.actions),
        risk_reasons: normalizeStringArray(modelVerdict?.risk_reasons, base.risk_reasons),
        verdict: safeString(modelVerdict?.verdict) || base.verdict,
        reason_codes: heuristics.reasonCodes.slice(),
        source: modelVerdict?.source === "heuristics" ? "heuristics" : "heuristics+model",
        simulation_status: base.simulation_status,
        intercepted_method: base.intercepted_method,
        facts: base.facts
      };
    }

    function shouldAskModel(heuristics) {
      return heuristics.parsed.simulationStatus === "succeeded";
    }

    function buildHumanActions(parsed, facts) {
      const actions = [];

      for (const change of facts.sol_changes) {
        const direction = change.direction === "in" ? "receives" : "spends";
        actions.push(`${change.account} ${direction} ${Math.abs(change.deltaSol)} SOL.`);
      }

      for (const change of facts.token_changes) {
        const direction = change.direction === "in" ? "receives" : "sends";
        actions.push(`${direction === "receives" ? "Receive" : "Send"} ${Math.abs(change.delta)} of ${change.mint}.`);
      }

      if (actions.length === 0 && Array.isArray(parsed.programs) && parsed.programs.length > 0) {
        for (const program of parsed.programs.slice(0, 5)) {
          actions.push(`Invoke ${program.label || "unknown"} program ${shorten(program.programId)} during ${parsed.method}.`);
        }
      }

      if (actions.length === 0) {
        actions.push("No balance deltas were extracted from the simulation.");
        actions.push(`Transaction source: ${parsed.sourceUrl || "unknown page"}.`);
      }

      return actions.slice(0, 8);
    }

    function buildHeuristicSummary(parsed, facts, reasonCodes) {
      if (parsed.simulationStatus === "failed") {
        return "The transaction could not be simulated successfully, so its effects are uncertain.";
      }

      if (reasonCodes.includes("token_drain_pattern")) {
        return "This transaction moves tokens out of the wallet without an obvious incoming asset.";
      }

      if (facts.total_sol_out > 0 && facts.total_token_in > 0) {
        return "This transaction spends SOL and receives another asset in return.";
      }

      if (facts.total_sol_out > 0 && facts.total_token_in === 0) {
        return "This transaction spends SOL without a clearly detected incoming asset.";
      }

      if (facts.total_token_in > 0) {
        return "This transaction changes token balances and may create or receive assets.";
      }

      return "This transaction interacts with Solana programs but has limited visible balance changes.";
    }

    function buildVerdictLine(risk, reasonCodes) {
      if (risk === "danger") {
        return "Do not proceed unless you fully trust the dApp and every asset movement matches your intent.";
      }

      if (reasonCodes.includes("unknown_program")) {
        return "Review the program interactions carefully before signing.";
      }

      return risk === "safe"
        ? "Proceed if the amounts and programs match what you expected."
        : "Proceed only if you fully understand the transaction effects.";
    }

    function buildReviewVerdict(summary, facts, reasonCodes, options = {}) {
      return {
        risk: options.risk || "review",
        summary,
        actions: normalizeStringArray(options.actions, ["Review the transaction details manually before signing."]),
        risk_reasons: normalizeStringArray(options.riskReasons, []),
        verdict: options.verdict || "Proceed only if you fully understand the transaction effects.",
        reason_codes: Array.isArray(reasonCodes) ? reasonCodes.slice() : [],
        source: options.source || "fallback",
        simulation_status: options.simulationStatus || "unknown",
        intercepted_method: options.interceptedMethod || "unknown",
        facts
      };
    }

    function buildFallbackFacts(context) {
      return {
        sol_changes: [],
        token_changes: [],
        programs: [],
        total_sol_out: 0,
        total_sol_in: 0,
        total_token_out: 0,
        total_token_in: 0,
        transferCount: 0,
        knownPrograms: [],
        unknownPrograms: [],
        warnings: [],
        rawMessagePreview: null,
        message_preview: "",
        source_url: context?.sourceUrl || ""
      };
    }

    function maxRisk(left, right) {
      const order = { safe: 0, review: 1, danger: 2 };
      return order[right] > order[left] ? right : left;
    }

    function addReason(reasonCodes, riskReasons, code, sentence) {
      if (!reasonCodes.includes(code)) {
        reasonCodes.push(code);
      }
      if (!riskReasons.includes(sentence)) {
        riskReasons.push(sentence);
      }
    }

    function normalizeStringArray(value, fallback) {
      if (!Array.isArray(value)) {
        return fallback.slice();
      }

      const cleaned = value.map((entry) => safeString(entry)).filter(Boolean);
      return cleaned.length > 0 ? dedupeStrings(cleaned) : fallback.slice();
    }

    function dedupeStrings(values) {
      return Array.from(new Set(values.filter(Boolean)));
    }

    function safeString(value) {
      return typeof value === "string" ? value.trim() : "";
    }

    function shorten(value) {
      if (!value || value.length < 10) {
        return value || "unknown";
      }

      return `${value.slice(0, 4)}...${value.slice(-4)}`;
    }

    async function getApiKey() {
      const keyName = storageKeys.OPENAI_API_KEY || "openai_api_key";
      const result = await chrome.storage.local.get(keyName);
      const storedKey = safeString(result?.[keyName]);
      if (storedKey) {
        return storedKey;
      }

      return loadApiKeyFromEnvLocal();
    }

    async function loadApiKeyFromEnvLocal() {
      if (!envLocalApiKeyPromise) {
        envLocalApiKeyPromise = (async () => {
          try {
            const response = await fetch(chrome.runtime.getURL(".env.local"), { cache: "no-store" });
            if (!response.ok) {
              debugLog("env.local not available", response.status);
              return "";
            }

            const content = await response.text();
            return parseEnvValue(content, "OPENAI_API_KEY");
          } catch (error) {
            debugLog("env.local load failed", error?.message || String(error));
            return "";
          }
        })();
      }

      return envLocalApiKeyPromise;
    }

    function parseEnvValue(content, key) {
      const line = String(content || "")
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find((entry) => entry && !entry.startsWith("#") && entry.startsWith(`${key}=`));

      if (!line) {
        return "";
      }

      const rawValue = line.slice(key.length + 1).trim();
      if (
        (rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ) {
        return rawValue.slice(1, -1).trim();
      }

      return rawValue;
    }

    function extractOpenAIText(data) {
      if (typeof data?.output_text === "string" && data.output_text.trim()) {
        return data.output_text.trim();
      }

      if (!Array.isArray(data?.output)) {
        return "";
      }

      const parts = [];
      for (const item of data.output) {
        if (!Array.isArray(item?.content)) {
          continue;
        }

        for (const content of item.content) {
          if (content?.type === "output_text" && typeof content.text === "string") {
            parts.push(content.text);
          }
        }
      }

      return parts.join("\n").trim();
    }

    function getCachedVerdict(key) {
      const entry = verdictCache.get(key);
      if (!entry) {
        return null;
      }

      if (Date.now() - entry.at > verdictCacheTtlMs) {
        verdictCache.delete(key);
        return null;
      }

      return entry.verdict;
    }

    function setCachedVerdict(key, verdict) {
      verdictCache.set(key, { at: Date.now(), verdict });
    }

    async function fetchJson(url, options, timeoutMs) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        });

        if (!response.ok) {
          const text = await response.text();
          debugLog("http error", url, response.status);
          throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
        }

        return await response.json();
      } finally {
        clearTimeout(timeoutId);
      }
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
