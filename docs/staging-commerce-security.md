# Staging commerce and public-form safety

The preview checkout is intentionally non-transactional. It has no payment fields, creates no durable order, reserves no stock, and defaults to a simulated completion that sends no email. The response and receipt explicitly identify that outcome as `simulated_only`.

Public guest-form email delivery is fail-closed. `PUBLIC_FORM_ANTI_ABUSE_READY` must remain `false` until a durable, distributed anti-abuse control is active and verified, such as a managed WAF rate limit and bot protection or a server-verified CAPTCHA. A process-local map or browser-only check does not satisfy this requirement. When the flag is unset or false, `/api/enquiry` returns `503 anti_abuse_not_configured` even if Resend credentials are present; the website keeps WhatsApp and direct workshop contact available as the manual fallback.

Staging-order email has a second opt-in: `STAGING_ORDER_EMAIL_DELIVERY_ENABLED=true`. Email is attempted only when both that flag and `PUBLIC_FORM_ANTI_ABUSE_READY=true` are set. Without the order-email flag, a valid checkout returns a simulated receipt and does not call Resend. If order email is requested while the anti-abuse flag is false, the endpoint returns `503 order_email_anti_abuse_not_configured` and sends nothing.

Every enquiry delivery uses a deterministic SHA-256-based Resend `Idempotency-Key`. This protects provider retries for an identical reference and payload. The staging endpoint also coalesces identical requests inside one warm server process, but labels this `best_effort_process_local`; it is not durable or distributed idempotency. A real order workflow still requires durable server-side order records, unique idempotency constraints, verified inventory/pricing, and an approved payment flow.

Live activation checklist:

- Deploy and verify durable WAF/bot protection or a server-verified managed CAPTCHA.
- Keep `PUBLIC_FORM_ANTI_ABUSE_READY=false` until that control is confirmed in production.
- Configure a verified Resend sender plus `RESEND_API_KEY`, `ENQUIRY_FROM_EMAIL`, and the intended recipient.
- Test suppression, duplicate retries, rate limits, Arabic and English templates, and delivery to the workshop inbox.
- Set `PUBLIC_FORM_ANTI_ABUSE_READY=true` only after those checks.
- Leave `STAGING_ORDER_EMAIL_DELIVERY_ENABLED=false` unless test-order emails are intentionally wanted; this still does not enable payments or create real orders.
