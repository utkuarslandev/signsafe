use anchor_lang::prelude::*;

// Solana Playground rewrites this automatically when you build.
declare_id!("11111111111111111111111111111111");

#[program]
pub mod signsafe_demo {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, start_at: u64) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.authority = ctx.accounts.authority.key();
        counter.count = start_at;
        counter.bump = ctx.bumps.counter;

        msg!("Counter created");
        msg!("Authority: {}", counter.authority);
        msg!("Starting value: {}", counter.count);

        Ok(())
    }

    pub fn increment(ctx: Context<UpdateCounter>, amount: u64) -> Result<()> {
        let counter = &mut ctx.accounts.counter;

        counter.count = counter
            .count
            .checked_add(amount)
            .ok_or(DemoError::Overflow)?;

        msg!("Counter incremented by {}", amount);
        msg!("New value: {}", counter.count);

        Ok(())
    }

    pub fn reset(ctx: Context<UpdateCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;

        msg!("Counter reset to 0");

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 8 + 1,
        seeds = [b"counter", authority.key().as_ref()],
        bump
    )]
    pub counter: Account<'info, Counter>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateCounter<'info> {
    #[account(
        mut,
        seeds = [b"counter", authority.key().as_ref()],
        bump = counter.bump,
        has_one = authority
    )]
    pub counter: Account<'info, Counter>,

    pub authority: Signer<'info>,
}

#[account]
pub struct Counter {
    pub authority: Pubkey,
    pub count: u64,
    pub bump: u8,
}

#[error_code]
pub enum DemoError {
    #[msg("Counter overflowed")]
    Overflow,
}
