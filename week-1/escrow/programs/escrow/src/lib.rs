use anchor_lang::prelude::*;

pub mod instructions;
use instructions::*;

pub mod state;
use state::*;

declare_id!("DrfqhqPg77jcQoKYGg3LSuqn16QbzHMirnUFjkfvyVdF");

#[program]
pub mod escrow {
    use super::*;

    pub fn make(ctx: Context<Make>, seed: u64, deposit: u64, receive: u64) -> Result<()> {
        ctx.accounts.init_escrow(seed, receive, &ctx.bumps)?;
        ctx.accounts.deposit(deposit)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        ctx.accounts.refund_and_close()
    }

    pub fn take(ctx: Context<Take>) -> Result<()> {
        ctx.accounts.deposit()?;
        ctx.accounts.withdraw_and_close()
    }
}

#[derive(Accounts)]
pub struct Initialize {}