# SiftGate ドキュメント

[ドキュメントホーム](../../README.md) · [プロジェクト README](../../../README.md)

SiftGate は、複数の AI プロバイダー、エージェント、アプリケーションを扱う
チーム向けのセルフホスト型 AI トラフィックゲートウェイです。ルーティング、
ポリシー、予算、監査、メタデータ証跡をローカルに保ち、既定では prompt、
response、未加工ヘッダー、プロバイダーキー、ツール payload、メディア bytes、
hidden reasoning、解決済み secret を保存しません。

## クイックスタート

```bash
git clone https://github.com/seanbabalala/ai-gateway.git
cd ai-gateway
npm install
cd frontend && npm install && cd ..
cp gateway.config.example.yaml gateway.config.yaml
cp .env.example .env
npm run build
npm start
```

`http://localhost:2099/dashboard` を開き、Provider Node を追加し、Gateway API Key
を作成して、`http://localhost:2099/v1/chat/completions` に最初のリクエストを送ります。

## 初回セットアップ

1. 現在の Workspace を確認します。
2. Provider Node を追加します。
3. Gateway API Key を作成します。
4. 必要に応じて Policy Namespace を関連付けます。
5. 日次 Budget のスコープと source of truth を確認します。
6. 最初のリクエストを送信します。
7. Logs と Route Explanation を確認します。
8. 必要な場合だけ Semantic Controls、Traffic Experiments、Evals、Shadow Traffic、MCP Tool Gateway を設定します。

## 主要概念

| 概念 | 意味 |
| --- | --- |
| Workspace | ローカル Dashboard とメタデータの境界。 |
| Provider Node | 設定済みの上流アカウント、デプロイ、プロキシ、またはローカル runtime。 |
| Gateway API Key | SiftGate が生成するクライアント向けキー。プロバイダーキーとは別物です。 |
| Policy Namespace | API Key、Team、予算、レート制限、ノード/モデル許可リストのための設定ベースのローカルポリシーラベル。 |
| MCP Tool Gateway | MCP ツール呼び出しのガバナンスとプロキシ。モデルルーティングではありません。 |

## ドキュメントマップ

- [Quickstart](../../QUICKSTART.md)
- [Docker Quickstart](../../DOCKER_QUICKSTART.md)
- [Dashboard](../../DASHBOARD.md)
- [OSS Concepts](../../OSS_CONCEPTS.md)
- [Provider Catalog](../../PROVIDER_CATALOG.md)
- [MCP Tool Gateway](../../MCP_GATEWAY.md)
- [Semantic Controls](../../SEMANTIC_PLATFORM.md)
- [Evaluation Framework](../../EVALUATION_FRAMEWORK.md)
- [API Reference](../../API_REFERENCE.md)
- [Production](../../PRODUCTION.md)
- [Security](../../SECURITY.md)
