# sheka_market — testnet deployment

Deployed 2026-06-15. 3-way parimutuel sports prediction market.

| Item | Value |
|---|---|
| **Package ID** | `0x950ce5ff57f5b28a6b38d4e5291f55cf503df2a85e6566905975c3faa178f716` |
| **AdminCap** | `0xb85a463f57b04700cc411fcf0ed63a6d6cfb8b0cfff7e1594f54bc546ad74253` (owner: demo wallet `0x76d1…37cd`) |
| **UpgradeCap** | `0x24ef9fc30d2cc1a47d75fcd1562ef0f1342ad5c397af2d2312208c3775f3d3ad` |
| **Publish digest** | `7qHDkTLSC2WGYXYfkTzN8quJ8evExWaSVKNW46FtvhG6` |
| **Stake coin** | DUSDC `0xe95040…::dusdc::DUSDC` |
| **Outcomes** | 0=HOME, 1=DRAW, 2=AWAY |

## Verified live (full cycle, real DUSDC)
create_market → stake HOME 1.0 + AWAY 0.5 → resolve(HOME) → claim: winner +1.5 DUSDC, loser 0. ✅
Move unit tests: 6/6 pass (`sui move test`).

## Entry functions (all generic over stake coin `T`, use DUSDC)
- `create_market<T>(&AdminCap, event_id: String, home: String, away: String)`
- `stake<T>(&mut Market<T>, outcome: u8, payment: Coin<T>)` → mints `Position` to sender
- `resolve<T>(&AdminCap, &mut Market<T>, winner: u8)`
- `claim<T>(&mut Market<T>, position: Position)` → pro-rata DUSDC; refunds all if winning pool empty
- views: `pools/total/status/winner`

## PTB notes (for backend/frontend)
- `tx.pure.string(...)` for the String args; `typeArguments: [DUSDC_TYPE]` on every call.
- `Market` is a shared object → `tx.object(marketId)`. Wait for tx (`waitForTransaction`) before referencing a freshly-created Market in the next tx (RPC propagation).
- stake: `splitCoins(dusdcCoin,[amount])` → pass the split coin to `stake`.
