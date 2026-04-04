// Solana Playground client script for demo/lib.rs
// No imports needed in Playground: anchor, web3, pg, and more are globally available.

const COUNTER_SEED = "counter";

async function main() {
  const authority = pg.wallet.publicKey;
  const [counterPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED), authority.toBuffer()],
    pg.program.programId
  );

  console.log("Program ID:", pg.program.programId.toBase58());
  console.log("Authority:", authority.toBase58());
  console.log("Counter PDA:", counterPda.toBase58());

  const existing = await pg.connection.getAccountInfo(counterPda);

  if (!existing) {
    console.log("Counter account not found. Initializing...");

    const initTx = await pg.program.methods
      .initialize(new anchor.BN(0))
      .accounts({
        counter: counterPda,
        authority,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Initialize tx:", initTx);
    await pg.connection.confirmTransaction(initTx);
  } else {
    console.log("Counter account already exists.");
  }

  const before = await pg.program.account.counter.fetch(counterPda);
  console.log("Counter before increment:", before.count.toString());

  const incrementTx = await pg.program.methods
    .increment(new anchor.BN(1))
    .accounts({
      counter: counterPda,
      authority,
    })
    .rpc();

  console.log("Increment tx:", incrementTx);
  await pg.connection.confirmTransaction(incrementTx);

  const after = await pg.program.account.counter.fetch(counterPda);
  console.log("Counter after increment:", after.count.toString());
  console.log(
    `Explorer: https://explorer.solana.com/address/${counterPda.toBase58()}?cluster=devnet`
  );
}

main()
  .then(() => console.log("Client run complete."))
  .catch((err) => {
    console.error(err);
    throw err;
  });
