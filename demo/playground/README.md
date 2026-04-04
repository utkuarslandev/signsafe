# Solana Playground Demo

This folder contains a complete live demo program for Solana Playground:

- `lib.rs`: Anchor program
- `client.ts`: one-click client script
- `anchor.test.ts`: repeatable Playground tests

## What This Demo Does

The program creates a per-wallet counter PDA.

- `initialize(start_at)`: creates the counter account for the current wallet
- `increment(amount)`: increments the counter
- `reset()`: resets the counter to `0`

This is a safe hackathon demo because it produces real signed Solana transactions, updates on-chain state, and is easy to explain live.

## Solana Playground Setup

1. Open Solana Playground:
   `https://beta.solpg.io`
2. Create a new project.
3. Choose `Anchor (Rust)`.
4. Replace `src/lib.rs` with the contents of `demo/lib.rs`.
5. Replace `client/client.ts` with the contents of `demo/client.ts`.
6. Replace `tests/anchor.test.ts` with the contents of `demo/anchor.test.ts`.
7. Click `Build`.
8. Click `Deploy`.

Important:
Solana Playground automatically rewrites the `declare_id!(...)` value in `lib.rs` during build so it matches the deployed program ID.

## Live Demo Flow

Use this sequence during the hackathon demo:

1. Fund the Playground wallet with devnet SOL if needed.
2. Build the program.
3. Deploy the program.
4. Run `client.ts`.
5. Show the transaction signature in the logs.
6. Show the updated counter PDA value in the logs.
7. Run the client again to show the counter increasing on-chain.
8. Run the tests to show deterministic verification.

## What Judges Will See

- A real Solana program deployed on devnet
- Real signed wallet transactions
- On-chain state changing after each transaction
- A simple, understandable PDA pattern
- A test suite proving the program behavior

## Recommended Script During Demo

Use wording like this:

"This is a minimal Solana program deployed from Solana Playground. Each wallet gets its own counter PDA. I sign one transaction to initialize it, then another to increment it. The state change is visible on-chain immediately."

## Notes

- This demo is intentionally simple and stable.
- It is better for live demos than a complex DeFi flow because failure modes are limited.
- If you want explorer links, `client.ts` prints a devnet Explorer URL after the transaction runs.
