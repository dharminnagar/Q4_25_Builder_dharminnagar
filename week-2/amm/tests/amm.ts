import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Amm } from "../target/types/amm";
import { expect } from "chai";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";

describe("AMM Test Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Amm as Program<Amm>;

  // Test accounts
  const admin = provider.wallet.publicKey;
  const user = anchor.web3.Keypair.generate();

  let mintX: anchor.web3.PublicKey;
  let mintY: anchor.web3.PublicKey;
  let mintLp: anchor.web3.PublicKey;
  let config: anchor.web3.PublicKey;
  let vaultX: anchor.web3.PublicKey;
  let vaultY: anchor.web3.PublicKey;
  let adminAtaX: anchor.web3.PublicKey;
  let adminAtaY: anchor.web3.PublicKey;
  let adminAtaLp: anchor.web3.PublicKey;
  let userAtaX: anchor.web3.PublicKey;
  let userAtaY: anchor.web3.PublicKey;
  let userAtaLp: anchor.web3.PublicKey;

  const seed = new anchor.BN(12345);
  const fee = 30; // 0.3% fee (30 basis points)

  before(async () => {
    // Airdrop SOL to admin and user
    const airdropSignature = await provider.connection.requestAirdrop(
      admin,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSignature);

    const userAirdrop = await provider.connection.requestAirdrop(
      user.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(userAirdrop);

    // Create token mints
    mintX = await createMint(
      provider.connection,
      provider.wallet.payer,
      admin,
      null,
      6
    );

    mintY = await createMint(
      provider.connection,
      provider.wallet.payer,
      admin,
      null,
      6
    );

    // Derive config PDA
    [config] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Derive LP mint PDA
    [mintLp] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), config.toBuffer()],
      program.programId
    );

    // Create associated token accounts for admin
    adminAtaX = await createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mintX,
      admin
    );

    adminAtaY = await createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mintY,
      admin
    );

    // Mint tokens to admin
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mintX,
      adminAtaX,
      admin,
      1_000_000_000
    );

    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mintY,
      adminAtaY,
      admin,
      1_000_000_000
    );

    // Create ATAs for user
    userAtaX = await createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mintX,
      user.publicKey
    );

    userAtaY = await createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mintY,
      user.publicKey
    );

    // Mint tokens to user
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mintX,
      userAtaX,
      admin,
      500_000_000
    );

    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mintY,
      userAtaY,
      admin,
      500_000_000
    );

    // Derive vault addresses
    vaultX = anchor.utils.token.associatedAddress({
      mint: mintX,
      owner: config,
    });

    vaultY = anchor.utils.token.associatedAddress({
      mint: mintY,
      owner: config,
    });

    adminAtaLp = anchor.utils.token.associatedAddress({
      mint: mintLp,
      owner: admin,
    });

    userAtaLp = anchor.utils.token.associatedAddress({
      mint: mintLp,
      owner: user.publicKey,
    });
  });

  describe("Initialize", () => {
    it("Initializes the AMM pool", async () => {
      await program.methods
        .initialize(seed, fee, null)
        .accountsStrict({
          initializer: admin,
          mintX: mintX,
          mintY: mintY,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          config: config,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const configAccount = await program.account.config.fetch(config);
      expect(configAccount.seed.toNumber()).to.equal(seed.toNumber());
      expect(configAccount.fee).to.equal(fee);
      expect(configAccount.mintX.toBase58()).to.equal(mintX.toBase58());
      expect(configAccount.mintY.toBase58()).to.equal(mintY.toBase58());
      expect(configAccount.locked).to.be.false;

      const lpMintAccount = await provider.connection.getAccountInfo(mintLp);
      expect(lpMintAccount).to.not.be.null;

      const vaultXAccount = await getAccount(provider.connection, vaultX);
      const vaultYAccount = await getAccount(provider.connection, vaultY);
      expect(vaultXAccount.amount).to.equal(0n);
      expect(vaultYAccount.amount).to.equal(0n);
    });
  });

  describe("Deposit (Add Liquidity)", () => {
    it("Deposits initial liquidity (first deposit)", async () => {
      const depositAmount = new anchor.BN(100_000_000);
      const maxX = new anchor.BN(100_000_000);
      const maxY = new anchor.BN(100_000_000);

      await program.methods
        .deposit(depositAmount, maxX, maxY)
        .accountsStrict({
          user: admin,
          mintX: mintX,
          mintY: mintY,
          config: config,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: adminAtaX,
          userY: adminAtaY,
          userLp: adminAtaLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();

      const vaultXAccount = await getAccount(provider.connection, vaultX);
      const vaultYAccount = await getAccount(provider.connection, vaultY);
      expect(vaultXAccount.amount).to.equal(BigInt(maxX.toString()));
      expect(vaultYAccount.amount).to.equal(BigInt(maxY.toString()));

      const adminLpAccount = await getAccount(provider.connection, adminAtaLp);
      expect(adminLpAccount.amount).to.equal(BigInt(depositAmount.toString()));
    });

    it("Deposits additional liquidity (proportional)", async () => {
      const depositAmount = new anchor.BN(50_000_000);
      const maxX = new anchor.BN(50_000_000);
      const maxY = new anchor.BN(50_000_000);

      const vaultXBefore = await getAccount(provider.connection, vaultX);
      const vaultYBefore = await getAccount(provider.connection, vaultY);
      const lpBefore = await getAccount(provider.connection, adminAtaLp);

      await program.methods
        .deposit(depositAmount, maxX, maxY)
        .accountsStrict({
          user: admin,
          mintX: mintX,
          mintY: mintY,
          config: config,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: adminAtaX,
          userY: adminAtaY,
          userLp: adminAtaLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();

      const vaultXAfter = await getAccount(provider.connection, vaultX);
      const vaultYAfter = await getAccount(provider.connection, vaultY);
      const lpAfter = await getAccount(provider.connection, adminAtaLp);

      expect(Number(vaultXAfter.amount)).to.be.greaterThan(Number(vaultXBefore.amount));
      expect(Number(vaultYAfter.amount)).to.be.greaterThan(Number(vaultYBefore.amount));
      expect(lpAfter.amount).to.equal(
        lpBefore.amount + BigInt(depositAmount.toString())
      );
    });

    it("Fails when amount is zero", async () => {
      try {
        await program.methods
          .deposit(new anchor.BN(0), new anchor.BN(100), new anchor.BN(100))
          .accountsStrict({
            user: admin,
            mintX: mintX,
            mintY: mintY,
            config: config,
            mintLp: mintLp,
            vaultX: vaultX,
            vaultY: vaultY,
            userX: adminAtaX,
            userY: adminAtaY,
            userLp: adminAtaLp,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAmount");
      }
    });
  });

  describe("Swap", () => {
    before(async () => {
      // Create user LP token account (required by Anchor account validation)
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        provider.wallet.payer,
        mintLp,
        user.publicKey
      );
    });

    it("Swaps X for Y", async () => {
      const amountIn = new anchor.BN(10_000_000);
      const minAmountOut = new anchor.BN(1);

      const userXBefore = await getAccount(provider.connection, userAtaX);
      const userYBefore = await getAccount(provider.connection, userAtaY);
      const vaultXBefore = await getAccount(provider.connection, vaultX);
      const vaultYBefore = await getAccount(provider.connection, vaultY);

      await program.methods
        .swap(true, amountIn, minAmountOut)
        .accountsStrict({
          user: user.publicKey,
          mintX: mintX,
          mintY: mintY,
          config: config,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: userAtaX,
          userY: userAtaY,
          userLp: userAtaLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      const userXAfter = await getAccount(provider.connection, userAtaX);
      const userYAfter = await getAccount(provider.connection, userAtaY);
      const vaultXAfter = await getAccount(provider.connection, vaultX);
      const vaultYAfter = await getAccount(provider.connection, vaultY);

      // Verify token movements
      expect(Number(userXAfter.amount)).to.be.lessThan(Number(userXBefore.amount));
      expect(Number(userYAfter.amount)).to.be.greaterThan(Number(userYBefore.amount));
      expect(Number(vaultXAfter.amount)).to.be.greaterThan(Number(vaultXBefore.amount));
      expect(Number(vaultYAfter.amount)).to.be.lessThan(Number(vaultYBefore.amount));

      // Verify constant product (k should increase or stay same due to fees)
      // Use BigInt for the multiplication to avoid overflow
      const kBefore = vaultXBefore.amount * vaultYBefore.amount;
      const kAfter = vaultXAfter.amount * vaultYAfter.amount;
      
      // Compare as strings to avoid Number conversion issues with large BigInts
      expect(kAfter >= kBefore).to.be.true;
    });

    it("Swaps Y for X", async () => {
      const amountIn = new anchor.BN(10_000_000);
      const minAmountOut = new anchor.BN(1);

      const userXBefore = await getAccount(provider.connection, userAtaX);
      const userYBefore = await getAccount(provider.connection, userAtaY);

      await program.methods
        .swap(false, amountIn, minAmountOut)
        .accountsStrict({
          user: user.publicKey,
          mintX: mintX,
          mintY: mintY,
          config: config,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: userAtaX,
          userY: userAtaY,
          userLp: userAtaLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      const userXAfter = await getAccount(provider.connection, userAtaX);
      const userYAfter = await getAccount(provider.connection, userAtaY);

      expect(Number(userYAfter.amount)).to.be.lessThan(Number(userYBefore.amount));
      expect(Number(userXAfter.amount)).to.be.greaterThan(Number(userXBefore.amount));
    });

    it("Fails when slippage exceeded", async () => {
      const amountIn = new anchor.BN(10_000_000);
      const minAmountOut = new anchor.BN(50_000_000);

      try {
        await program.methods
          .swap(true, amountIn, minAmountOut)
          .accountsStrict({
            user: user.publicKey,
            mintX: mintX,
            mintY: mintY,
            config: config,
            mintLp: mintLp,
            vaultX: vaultX,
            vaultY: vaultY,
            userX: userAtaX,
            userY: userAtaY,
            userLp: userAtaLp,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err) {
        expect(err.toString()).to.satisfy((msg: string) =>
          msg.includes("SlippageExceeded") || msg.includes("CurveError")
        );
      }
    });

    it("Fails when amount is zero", async () => {
      try {
        await program.methods
          .swap(true, new anchor.BN(0), new anchor.BN(0))
          .accountsStrict({
            user: user.publicKey,
            mintX: mintX,
            mintY: mintY,
            config: config,
            mintLp: mintLp,
            vaultX: vaultX,
            vaultY: vaultY,
            userX: userAtaX,
            userY: userAtaY,
            userLp: userAtaLp,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAmount");
      }
    });
  });

  describe("Withdraw (Remove Liquidity)", () => {
    it("Withdraws liquidity", async () => {
      const withdrawAmount = new anchor.BN(25_000_000);
      const minX = new anchor.BN(1);
      const minY = new anchor.BN(1);

      const adminLpBefore = await getAccount(provider.connection, adminAtaLp);
      const vaultXBefore = await getAccount(provider.connection, vaultX);
      const vaultYBefore = await getAccount(provider.connection, vaultY);

      await program.methods
        .withdraw(withdrawAmount, minX, minY)
        .accountsStrict({
          user: admin,
          mintX: mintX,
          mintY: mintY,
          config: config,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: adminAtaX,
          userY: adminAtaY,
          userLp: adminAtaLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();

      const adminLpAfter = await getAccount(provider.connection, adminAtaLp);
      const vaultXAfter = await getAccount(provider.connection, vaultX);
      const vaultYAfter = await getAccount(provider.connection, vaultY);

      expect(adminLpAfter.amount).to.equal(
        adminLpBefore.amount - BigInt(withdrawAmount.toString())
      );
      expect(Number(vaultXAfter.amount)).to.be.lessThan(Number(vaultXBefore.amount));
      expect(Number(vaultYAfter.amount)).to.be.lessThan(Number(vaultYBefore.amount));
    });

    it("Fails when slippage exceeded on withdrawal", async () => {
      const withdrawAmount = new anchor.BN(10_000_000);
      const minX = new anchor.BN(1_000_000_000);
      const minY = new anchor.BN(1_000_000_000);

      try {
        await program.methods
          .withdraw(withdrawAmount, minX, minY)
          .accountsStrict({
            user: admin,
            mintX: mintX,
            mintY: mintY,
            config: config,
            mintLp: mintLp,
            vaultX: vaultX,
            vaultY: vaultY,
            userX: adminAtaX,
            userY: adminAtaY,
            userLp: adminAtaLp,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err) {
        expect(err.toString()).to.include("SlippageExceeded");
      }
    });

    it("Fails when amount is zero", async () => {
      try {
        await program.methods
          .withdraw(new anchor.BN(0), new anchor.BN(0), new anchor.BN(0))
          .accountsStrict({
            user: admin,
            mintX: mintX,
            mintY: mintY,
            config: config,
            mintLp: mintLp,
            vaultX: vaultX,
            vaultY: vaultY,
            userX: adminAtaX,
            userY: adminAtaY,
            userLp: adminAtaLp,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAmount");
      }
    });
  });
});