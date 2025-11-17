use anchor_lang::prelude::*;
use anchor_spl::associated_token::spl_associated_token_account::solana_program::stake;
use mpl_core::{
    instructions::AddPluginV1CpiBuilder,
    types::{FreezeDelegate, Plugin, PluginAuthority},
    ID as CORE_PROGRAM_ID,
};

use crate::{
    errors::StakeError,
    state::{StakeAccount, StakeConfig, UserAccount},
};

#[derive(Accounts)]
pub struct Stake<'info> {
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
        bump,
    )]
    pub config: Account<'info, StakeConfig>,

    #[account(
        init,
        payer = user,
        seeds = [b"stake".as_ref(), config.key().as_ref(), asset.key().as_ref()],
        space = StakeAccount::DISCRIMINATOR.len() + StakeAccount::INIT_SPACE,
        bump,

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

impl<'info> Stake<'info> {
    pub fn stake(&mut self, bumps: &StakeBumps) -> Result<()> {
        require!(self.user_account.amount_staked < self.config.max_stake, StakeError::MaxStakeReached);

        self.stake_account.set_inner( StakeAccount { 
            owner: (self.user.key()), 
            mint: (self.asset.key()), 
            staked_at: (Clock::get()?.unix_timestamp), 
            bump: (bumps.stake_account) 
        });

        self.user_account.amount_staked += 1;

        AddPluginV1CpiBuilder::new(&self.core_program.to_account_info())
            .asset(&self.asset.to_account_info())
            .collection(Some(&self.collection.to_account_info()))
            .plugin(Plugin::FreezeDelegate(FreezeDelegate {
                 frozen: (true) // true -> freeze the NFT
                })
            )
            .authority(None)
            .payer(&self.user.to_account_info())
            .system_program(&self.system_program.to_account_info())
            .invoke()?;

        Ok(())
    }
}
