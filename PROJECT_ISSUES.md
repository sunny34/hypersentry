# 🛠 HyperSentry Project Tracking & Issue Backlog

This document tracks all active issues, feature requests, and technical debt for the HyperSentry project. All feature development should occur on branches following the `feature/<name>` or `fix/<name>` convention.

---

## 🚦 System Status Summary
- **Current Branch**: `feature/deployment-hardening`
- **Deployment Strategy**: Coolify (Self-hosted PaaS)
- **Next Primary Milestone**: Alpha-1 Production Launch

---

## 🔴 Critical / High Priority (Bugs & Security)
| ID | Title | Status | Assignee | Notes |
|:---|:---|:---|:---|:---|
| #001 | **SSL/WS Upgrade Handshake** | 🟡 Testing | AI | Ensure Traefik handles `Upgrade: websocket` correctly in Coolify. |
| #002 | **Private Strategy Leaks** | 🟢 Fixed | AI | Enforced `user_id` binding on all private event bus packets. |
| #003 | **Rate Limit Circuit Breakers** | 🟡 In-Progress | AI | Implement exponential backoff if exchange returns 429. |

## 🟡 Medium Priority (Features & UX)
| ID | Title | Status | Assignee | Notes |
|:---|:---|:---|:---|:---|
| #101 | **Whale Alert Sound Engine** | 🟢 Fixed | AI | Institutional sonar ping for $1M+ mega-trades. |
| #102 | **CVD Compact Formatting** | 🟢 Fixed | AI | Map millions/billions/trillions in Signal DNA sidebar. |
| #103 | **Historical CVD Persistence** | ⚪️ Backlog | - | Move live CVD snapshots to long-term DB storage. |

## 🟢 Low Priority / Technical Debt
| ID | Title | Status | Assignee | Notes |
|:---|:---|:---|:---|:---|
| #201 | **README Refurbish** | 🟢 Fixed | AI | Professionalized documentation for public repo view. |
| #202 | **Docker Image Optimization** | 🟡 In-Progress | AI | Use multi-stage builds to reduce backend image size. |
| #203 | **Frontend Unit Tests** | ⚪️ Backlog | - | Coverage for `useAlphaStore` logic. |

---

## 🧪 Testing Ledger (Post-Deployment)
| Feature | Local | Prod-Mirror | Results |
|:---|:---|:---|:---|
| WS Connectivity | Pass | - | Agg_update received |
| Gunicorn Concurrency | Pass | - | Handled 10 simultaneous clients |
| Kafka Persistence | Pass | - | Events survived restart |

---

## 📝 Contribution Workflow
1.  **Issue Identification**: Add new items to this file under the appropriate priority.
2.  **Branching**: `git checkout -b feature/<your-feature>` or `fix/<your-fix>`.
3.  **Documentation**: Update relevant `.md` files (README, DEPLOYMENT, etc).
4.  **Merge**: Verify against the **System Architecture** before merging to `main`.
