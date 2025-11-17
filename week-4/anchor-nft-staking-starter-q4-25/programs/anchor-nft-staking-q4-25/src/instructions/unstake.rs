use anchor_lang::prelude::*;
use mpl_core::{
    instructions::{RemovePluginV1CpiBuilder, UpdatePluginV1CpiBuilder},
    types::{FreezeDelegate, Plugin, PluginType},
    ID as CORE_PROGRAM_ID,
};

use crate::{
    errors::StakeError,
    state::{StakeAccount, StakeConfig, UserAccount},
};

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        constraint = !asset.data_is_empty() @ StakeError::AssetNotInitialized,
        constraint = asset.owner == &CORE_PROGRAM_ID @ StakeError::NotOwner
    )]
    /// CHECK: verified by Core
    pub asset: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"user".as_ref(), user.key().as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        seeds = [b"config".as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StakeConfig>,

    #[account(
        mut,
        close = user,
        seeds = [b"stake".as_ref(), config.key().as_ref(), asset.key().as_ref()],
        bump = stake_account.bump,
    )]
    pub stake_account: Account<'info, StakeAccount>,

    #[account(
        mut,
        constraint = collection.owner == &CORE_PROGRAM_ID @ StakeError::InvalidCollection,
        constraint = !collection.data_is_empty() @ StakeError::CollectionNotInitialized
    )]
    /// CHECK: Verified by mpl-core
    pub collection: UncheckedAccount<'info>,

    #[account(address = CORE_PROGRAM_ID)]
    /// CHECK: Verified by address constraint
    pub core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> Unstake<'info> {
    pub fn unstake(&mut self) -> Result<()> {
        let elapsed = Clock::get()?.unix_timestamp - self.stake_account.staked_at as i64;

        require!(elapsed >= self.config.freeze_period as i64, StakeError::FreezePeriodNotPassed);

        let signer_seeds: &[&[&[u8]]] = &[&[
            b"stake",
            &self.config.key().to_bytes(),
            &self.asset.key().to_bytes(),
            &[self.stake_account.bump],
        ]];

        self.user_account.amount_staked -= 1;

        // allow to keep earning points after the freeze period
        self.user_account.points += self.config.points_per_stake as u32;

        UpdatePluginV1CpiBuilder::new(&self.core_program.to_account_info())
            .asset(&self.asset.to_account_info())
            .plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: false }))
            .collection(Some(&self.collection.to_account_info()))
            .authority(None)
            .payer(&self.user.to_account_info())
            .system_program(&self.system_program.to_account_info())
            .invoke_signed(signer_seeds)?;

        RemovePluginV1CpiBuilder::new(&self.core_program.to_account_info())
            .asset(&self.asset.to_account_info())
            .plugin_type(PluginType::FreezeDelegate)
            .collection(Some(&self.collection.to_account_info()))
            .authority(None)
            .payer(&self.user.to_account_info())
            .system_program(&self.system_program.to_account_info())
            .invoke_signed(signer_seeds)?;

        Ok(())
    }
}
