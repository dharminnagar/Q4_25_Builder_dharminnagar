use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken, 
    token::{Mint, Token, TokenAccount, Transfer, transfer}
};
use constant_product_curve::{ConstantProduct, LiquidityPair};

use crate::{errors::AmmError, state::Config};


#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub mint_x: Account<'info, Mint>,
    pub mint_y: Account<'info, Mint>,

    #[account(
        has_one = mint_x,
        has_one = mint_y,
        seeds = [b"config", config.seed.to_le_bytes().as_ref()],
        bump = config.config_bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [b"lp", config.key().as_ref()],
        bump = config.lp_bump,
    )]
    pub mint_lp: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = config,
    )]
    pub vault_x: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = config,
    )]
    pub vault_y: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = user,
    )]
    pub user_x: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = user,
    )]
    pub user_y: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_lp,
        associated_token::authority = user,
    )]
    pub user_lp: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

// we first have to determine which token is being swapped in and which is being swapped out
// then have to determine the amount out using the constant product crate
// 
impl<'info> Swap<'info> {
    pub fn swap(
        &mut self,
        is_x: bool,
        amount_in: u64,
        min_amount_out: u64,
    ) -> Result<()> {
        require!(self.config.locked == false, AmmError::PoolLocked);
        require!(amount_in > 0, AmmError::InvalidAmount);

        let mut curve = ConstantProduct::init(
            self.vault_x.amount, 
            self.vault_y.amount, 
            self.mint_lp.supply,
            self.config.fee, 
            Some(6))
            .map_err(|_| AmmError::CurveError)?;

        let pair = match is_x {
            true => LiquidityPair::X,
            false => LiquidityPair::Y
        };

        let swap_result = curve.swap(pair, amount_in, min_amount_out).map_err(|_| AmmError::CurveError)?;


        let output_amount = swap_result.withdraw;
        let input_amount = swap_result.deposit;


        require!(output_amount > 0 && output_amount >= min_amount_out, AmmError::SlippageExceeded);

        self.deposit_tokens(is_x, input_amount)?;
        self.withdraw_tokens(!is_x, output_amount)
        
        // IF WE WANT TO DO MANUALLY
        // Calculate output using constant product formula: x * y = k
        // After swap: (x + amount_in * (1 - fee)) * (y - amount_out) = k
        // Therefore: amount_out = y - (x * y) / (x + amount_in * (1 - fee))

        // let (input_reserve, output_reserve) = match is_x {
        //     true => (
        //         self.vault_x.amount,
        //         self.vault_y.amount,
        //     ),
        //     false => (
        //         self.vault_y.amount,
        //         self.vault_x.amount,
        //     )
        // };

        // require!(input_reserve > 0 && output_reserve > 0, AmmError::NoLiquidityInPool);

        // Apply fee: amount_in_with_fee = amount_in * (10000 - fee) / 10000
        // let fee_bps = self.config.fee as u128;
        // let amount_in_u128 = amount_in as u128;
        // let amount_in_after_fee = amount_in_u128
        //     .checked_mul(10000u128.checked_sub(fee_bps)
        //     .ok_or(AmmError::InvalidFee)?)
        //     .ok_or(AmmError::Overflow)?;
        
        // // Calculate the output amount
        // let numerator = amount_in_after_fee
        //     .checked_mul(output_reserve as u128)
        //     .ok_or(AmmError::Overflow)?;

        // let denominator = (input_reserve as u128)
        //     .checked_mul(10000u128)
        //     .ok_or(AmmError::Overflow)?
        //     .checked_add(amount_in_after_fee)
        //     .ok_or(AmmError::Overflow)?;

        // let output = (numerator / denominator) as u64;

        // // Check slippage protection
        // require!(output >= min_amount_out, AmmError::SlippageExceeded);

        // self.deposit_tokens(is_x, amount_in)?;

        // self.deposit_tokens(!is_x, output)
    }

    pub fn deposit_tokens(&mut self, is_x: bool, amount: u64) -> Result<()> {
        let (from, to) = match is_x {
            true => (
                self.user_x.to_account_info(),
                self.vault_x.to_account_info(),
            ),
            false => (
                self.user_y.to_account_info(),
                self.vault_y.to_account_info(),
            )
        };

        let transfer_accounts = Transfer {
            from: from,
            to: to,
            authority: self.user.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(self.token_program.to_account_info(), transfer_accounts);

        transfer(cpi_ctx, amount)
    }

    pub fn withdraw_tokens(&mut self, is_x: bool, amount: u64) -> Result<()> {
        let (from, to) = match is_x {
            true => (
                self.vault_x.to_account_info(),
                self.user_x.to_account_info(),
            ),
            false => (
                self.vault_y.to_account_info(),
                self.user_y.to_account_info(),
            )
        };

        let transfer_accounts = Transfer {
            from: from,
            to: to,
            authority: self.config.to_account_info(),
        };

        let signer_seeds: &[&[&[u8]]] = &[
            &[
                b"config",
                &self.config.seed.to_le_bytes(),
                &[self.config.config_bump]
            ]
        ];

        let cpi_ctx = CpiContext::new_with_signer(self.token_program.to_account_info(), transfer_accounts, signer_seeds);

        transfer(cpi_ctx, amount)
    }
}