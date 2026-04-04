// Solana Playground test file for demo/lib.rs
// No imports needed in Playground: anchor, web3, pg, assert, and more are globally available.

describe("signsafe-demo", () => {
  const authority = pg.wallet.publicKey;
  const [counterPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), authority.toBuffer()],
    pg.program.programId
  );

  before(async () => {
    const existing = await pg.connection.getAccountInfo(counterPda);

    if (!existing) {
      const tx = await pg.program.methods
        .initialize(new anchor.BN(0))
        .accounts({
          counter: counterPda,
          authority,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();

      console.log("initialize tx:", tx);
      await pg.connection.confirmTransaction(tx);
    }
  });

  it("increments the counter", async () => {
    const before = await pg.program.account.counter.fetch(counterPda);

    const tx = await pg.program.methods
      .increment(new anchor.BN(1))
      .accounts({
        counter: counterPda,
        authority,
      })
      .rpc();

    console.log("increment tx:", tx);
    await pg.connection.confirmTransaction(tx);

    const after = await pg.program.account.counter.fetch(counterPda);

    assert.equal(
      after.count.toString(),
      before.count.add(new anchor.BN(1)).toString()
    );
  });

  it("resets the counter", async () => {
    const tx = await pg.program.methods
      .reset()
      .accounts({
        counter: counterPda,
        authority,
      })
      .rpc();

    console.log("reset tx:", tx);
    await pg.connection.confirmTransaction(tx);

    const counter = await pg.program.account.counter.fetch(counterPda);
    assert.equal(counter.count.toString(), "0");
  });
});
