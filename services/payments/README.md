# Payment providers

Every call to a payment service provider (PSP) goes through an adapter in this
folder. Nothing else in the codebase talks to Flutterwave or Monnify directly.

```js
const payments = require("./services/payments");
payments.getProvider();            // the active provider (PAYMENT_PROVIDER, default "monnify")
payments.getProvider("flutterwave"); // a specific one, e.g. to refund a charge it took
```

## The interface

All amounts are naira Numbers. `reference` is always **ours** (the order's
`paymentIntent.reference`, a withdrawal's `WD_…`, a refund's
`providerRefundReference`) so a call can be re-queried after a timeout.

| Method | Returns |
| --- | --- |
| `initializeCheckout({ reference, amount, currency, customer, description, redirectUrl, metadata })` | `{ checkoutUrl, providerReference }` |
| `verifyCharge({ reference })` | `{ status, reference, providerTransactionId, amount, currency, providerStatus }` — `status` is `succeeded` \| `pending` \| `failed` |
| `verifyWebhookSignature({ headers, rawBody })` | `true` / `false` |
| `parseWebhook(body)` | `{ type: "charge.succeeded", reference, providerTransactionId }`, `{ type: "transfer.updated", reference, providerTransferId, providerStatus }`, or `null` (ignored event) |
| `refund({ providerTransactionId, amount, refundReference, reason })` | `{ outcome, providerRefundId, providerStatus, message }` — `outcome` is `succeeded` \| `pending` \| `rejected` \| `unknown` |
| `getRefundStatus({ refundReference, providerRefundId })` | same shape as `refund`, or `null` when the provider cannot be asked |
| `transfer({ amount, reference, narration, bankCode, accountNumber, accountName })` | `{ outcome, reference, providerTransferId, providerStatus, message }` — `outcome` is `succeeded` \| `pending` \| `failed`; `failed` means nothing moved |
| `getTransferStatus({ reference, providerTransferId })` | same shape as `transfer`, with `outcome` also `not_found`; or `null` when the provider cannot be asked (Flutterwave without its id) |
| `listBanks()` | `[{ code, name }]` |
| `resolveAccount({ accountNumber, bankCode })` | `{ accountNumber, accountName, bankCode }` |

Adapters never throw for a provider *answer* (a declined refund is a result);
they throw `PaymentProviderError` for configuration problems and transport
failures the caller must treat as "unknown".

## Webhooks

`POST /api/payment/webhook/:provider`. The signature is checked, then the
event is **re-verified with the provider's API** before any money is booked
(`services/webhookPaymentProcessor`), so a webhook is only ever a hint.

Monnify: enable `SUCCESSFUL_TRANSACTION` and the three disbursement events
(`SUCCESSFUL_DISBURSEMENT`, `FAILED_DISBURSEMENT`, `REVERSED_DISBURSEMENT`).
Flutterwave: `charge.completed` and `transfer.completed`.

## Payouts

Wallet withdrawals are paid out by `services/withdrawalPayoutService`. Approval
claims the withdrawal, then sends the transfer; the ledger row stays `pending`
(`payout.status: in_transit`) until the provider confirms it via the transfer
response, a disbursement webhook, or the 5-minute requery cron. A failed or
reversed payout returns amount + fee to the wallet; one stuck in transit for
24 hours alerts admins. Monnify payouts need **2FA for API disbursements
switched off**, otherwise each transfer waits for an OTP
(`PENDING_AUTHORIZATION`) and only completes once someone enters it.

## Environment

| Variable | Used by |
| --- | --- |
| `PAYMENT_PROVIDER` | `monnify` (default) or `flutterwave` — the provider new checkouts, payouts and bank lookups use |
| `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, `MONNIFY_CONTRACT_CODE` | Monnify; the secret key also signs webhooks |
| `MONNIFY_WALLET_ACCOUNT_NUMBER` | Monnify payouts (the disbursement wallet's account number) |
| `MONNIFY_ENV` | `SANDBOX` (default) or `LIVE` |
| `FLW_SECRET_KEY`, `FLW_WEBHOOK_SECRET_HASH` | Flutterwave |
