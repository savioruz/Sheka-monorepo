# sheka_analysis — testnet deployment

Deployed 2026-06-15. Secure pay-per-analysis: on-chain prices, treasury, on-chain free quota,
ownable `AnalysisReceipt`, Seal `seal_approve` policy.

| Item | Value |
|---|---|
| **Package** | `0xed2881e51116fc7167721ac2b17762494c29ab288c646ca63f9fd02dce10f23f` |
| **AdminCap** | `0x34de61c7156611250a8c05463119ef2b25d42a07366c5ff10503808a11410b60` |
| **Registry** | `0x26eef29d5022b2c8f6420aae0ac821a686cdbc109722b361d8bec37a40a11a99` |
| **Treasury** | `0xbc14520c78df1743b4a299ad0300e55d30360063496fc477d13f7b6023ebcac1` |
| **Quota** | `0x9aefb8602c2abc787ea5f0f0890296f4ae9a1294ffd880773a92d70ef40dde88` |
| **Publish digest** | `EeR5yHwQ9nFBQyTbNk6XTXFkgu6dVxi9V6UxSGrrxFgc` |

## Seeded prices (on-chain, MIST)
| model_id | model | price |
|---|---|---|
| 0 | Auto (free 3×, then paid) | 0.05 SUI |
| 1 | claude-sonnet-4.6 | 0.10 SUI |
| 2 | claude-opus-4.8 | 0.25 SUI |
| 3 | gpt-5.4 | 0.15 SUI |

Free limit (on-chain `Quota.free_limit`) = 3. Tests: 8/8 (`sui move test`).

## Entry points (PTB)
- `purchase(registry, treasury, payment: Coin<SUI>, model_id)` → mints `AnalysisReceipt`, emits `AnalysisPurchased`.
- `claim_free(quota, model_id=0)` → on-chain quota, mints free receipt, emits `FreeClaimed`.
- `seal_approve(id: vector<u8>, receipt: &AnalysisReceipt)` → Seal decryption gate (id == receipt id).
- admin: `set_price`, `set_free_limit`, `withdraw`.
