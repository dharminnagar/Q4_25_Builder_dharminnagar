import {
    address,
    appendTransactionMessageInstructions,
    assertIsTransactionWithinSizeLimit,
    compileTransaction,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    createTransactionMessage,
    devnet,
    generateKeyPairSigner,
    getSignatureFromTransaction,
    lamports,
    pipe,
    sendAndConfirmTransactionFactory,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    type TransactionMessageBytesBase64
} from "@solana/kit";

import { getTransferSolInstruction } from "@solana-program/system";
import wallet from "./dev-wallet.json";

const LAMPORTS_PER_SOL = BigInt(1_000_000_000);

async function transfer() {
    // Define our Turbin3 wallet to send to
    const keypair = await createKeyPairSignerFromBytes(new Uint8Array(wallet));
    const turbin3Wallet = address("zUrwhaWq1bUPL6FgRBnmbhRyxaUP9rhBRmao1q3h61V");

    // Create an rpc connection
    const rpc = createSolanaRpc(devnet("https://devnet.helius-rpc.com/?api-key=d1c7b3e1-2658-47f8-9291-7d39970f2803"));
    const rpcSubscriptions = createSolanaRpcSubscriptions(devnet("wss://devnet.helius-rpc.com/?api-key=d1c7b3e1-2658-47f8-9291-7d39970f2803"));
    console.log(`Sending from ${keypair.address} to ${turbin3Wallet}`);

    // const transferInstruction = getTransferSolInstruction({
    //     source: keypair,
    //     destination: turbin3Wallet,
    //     amount: lamports(1n * LAMPORTS_PER_SOL)
    // });

    // const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    // const transactionMessage = pipe(
    //     createTransactionMessage({ version: 0 }),
    //     tx => setTransactionMessageFeePayerSigner(keypair, tx),
    //     tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    //     tx => appendTransactionMessageInstructions([transferInstruction], tx)
    // );

    // const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    // assertIsTransactionWithinSizeLimit(signedTransaction);

    // const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
    // try {
    //     await sendAndConfirmTransaction(
    //     signedTransaction,
    //     { commitment: 'confirmed' }
    //     );
    //     const signature = getSignatureFromTransaction(signedTransaction);
    //     console.log(`Success! Check out your TX here:
    //     https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    // } catch (e) {
    //     console.error('Transfer failed:', e);
    // }

    // First get the balance from our wallet
    const { value: balance } = await rpc.getBalance(keypair.address).send();
    console.log(`Current balance: ${lamports(balance)} lamports (${Number(balance) / Number(LAMPORTS_PER_SOL)} SOL)`);
    
    // Build a dummy transfer instruction with 0 amount to calculate the fee
    const dummyTransferInstruction = getTransferSolInstruction({
        source: keypair,
        destination: turbin3Wallet,
        amount: lamports(balance)
    });

    const latestBlockhash = await rpc.getLatestBlockhash().send().then(res => res.value);

    const dummyTransactionMessage = pipe(createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayerSigner(keypair, tx),
        tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        tx => appendTransactionMessageInstructions([dummyTransferInstruction], tx)
    );

    // Compile the dummy transaction message to get the message bytes
    const compiledDummy = compileTransaction(dummyTransactionMessage);
    const dummyMessageBase64 = Buffer.from(compiledDummy.messageBytes).toString('base64') as TransactionMessageBytesBase64;

    console.log('Calculating transaction fee...');

    // Calculate the transaction fee
    const { value: fee } = await rpc.getFeeForMessage(dummyMessageBase64).send() || 0n;
    if (fee === null) {
        throw new Error('Unable to calculate transaction fee');
    }

    if (balance < fee ) {
        throw new Error(`Insufficient balance to cover the transaction fee. Balance: ${balance}, Fee: ${fee}`);
    }

    // Calculate the exact amount to send (balance minus fee)
    const sendAmount = balance - fee;

    console.log(`Sending ${sendAmount} lamports (${Number(sendAmount) / Number(LAMPORTS_PER_SOL)} SOL) to ${turbin3Wallet}`);
    
    const transferInstruction = getTransferSolInstruction({
        source: keypair,
        destination: turbin3Wallet,
        amount: lamports(sendAmount)
    });

    const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayerSigner(keypair, tx),
        tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        tx => appendTransactionMessageInstructions([transferInstruction], tx)
    );

    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithinSizeLimit(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    console.log('Sending transaction...');

    try {
        await sendAndConfirmTransaction(
            signedTransaction,
            { commitment: 'confirmed' }
        );
        const signature = getSignatureFromTransaction(signedTransaction);
        console.log(`Success! Check out your TX here: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    } catch (e) {
        console.error('Transfer failed:', e);
    }

}

transfer().catch(console.error);