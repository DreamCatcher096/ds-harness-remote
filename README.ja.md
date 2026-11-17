# Pi Web Remote

**別の Agent を起動せず、同じ Pi Web セッションを Android のネイティブ UI から利用する。**

[中文](README.zh.md) · [English](README.en.md) · [日本語](README.ja.md)

Pi Web Remote は [DSH Remote](https://github.com/liguobao/ds-harness-remote) から派生した独立プロジェクトです。上流の暗号化通信、プロトコル、Android UI を再利用し、Pi Web 向けのネイティブチャットと完全な質問フォームを提供することを目指します。汎用の DSH／複数 Agent クライアントを拡張し続けることが目的ではありません。

> **現在は開発中のソースプロジェクトであり、すぐに使えるモバイル遠隔操作製品ではありません。** 隔離環境でのソース連携、契約テスト、オフライン Android エミュレーター検証を完了しています。実アカウント、実 Host、ネットワーク越しの接続、実機、本番導入は未検証です。上流のアプリや npm リリースには、本 fork の Pi Web 向け変更は含まれていません。

## このプロジェクトの目的

パソコンで Pi Web を使った後、席を離れても、スマートフォンから**実行中の同じセッションと Agent インスタンス**にアクセスし、ツール、プロジェクトのコンテキスト、タスクを引き継げるようにします。スマートフォンや Host で別の Pi を起動する方式ではありません。

目標は次のとおりです。

- **同一インスタンスへの接続**：独立 Host が、既存の Pi Web が保持する元の SDK／Agent を橋渡しします。同期を模倣するために `pi`、`pi-acp`、別の SDK セッションを起動しません。
- **ネイティブチャット**：Android でセッション一覧と履歴を読み、テキスト、思考、通常のツール結果をストリーミング表示し、明示的にテキスト送信や元タスクの停止を行います。
- **完全なネイティブ質問フォーム**：単一選択、複数選択、自由入力、フォーム全体の送信、キャンセル、明確な受領結果、他端末で処理された場合の無効化に対応します。数字入力や Web ページへの遷移で代用しません。
- **暗号化ネットワークの再利用**：Remote の Noise エンドツーエンド暗号化チャネルを維持し、P2P を優先して TURN／Relay にフォールバックします。Android の VPN スロットは使いません。
- **将来の Web 入口**：同じ暗号化ネットワーク経由で Pi Web ページを埋め込む予定です。現段階では WebView を実装・有効化していません。

## 現在の状況

### 実装済み・隔離環境で検証済み

- `pi-web.*` プロトコル、独立 Pi Web Host、client-core 状態機械、Android の独立 Pi Web 入口。
- 元インスタンスとの関連付け、セッション一覧／履歴、ストリーミング、送信／停止、質問フォームの送信／キャンセルの契約。
- 実際のセッション、インスタンス、呼び出し、質問／選択肢の識別子による操作の関連付け。受領結果が不確かな場合は `unknown` と表示し、書き込みを自動再送せず、元の操作を照会します。
- 一時的なデモ画面ではなく、元アプリのトップバー、メッセージ、入力欄、ドロワー、質問フォームのスタイルを再利用。
- オフラインエミュレーターでの送信／停止、フォーム全体の回答、キャンセル受領結果の欠落後の再接続・照会、他端末での処理による無効化、インスタンス交代などのネイティブ操作。

根拠と制限は [P3 ソース・契約検証記録](docs/pi-web-remote/P3-RESULTS.md) と [P3.1 オフラインエミュレーター記録](docs/pi-web-remote/P3.1-RESULTS.md) を参照してください。これらは過去の実行記録であり、この README 更新時にテストを再実行したものではありません。

### 未完了または未検証

- 上流作者のホスティングサービスにおける独立 Host の接続許可、アカウント要件、料金、および実際の P2P／TURN／Relay・携帯回線接続。
- 通常アプリのログインと実 Host 連携、スマートフォン実機での検証、元インスタンス／モデルを使った実操作、本番導入。
- Pi Web ページの埋め込み／WebView。
- Pi Web ネイティブ入口でのモデル／provider 切り替え、添付／画像、セッション作成／復元、汎用ファイルアクセス、ターミナル。上流が対応していても、本 fork の Pi Web backend に接続済みとは限りません。

既存のテスト APK は **INTERNET 権限のない x86_64 オフラインエミュレーター用**であり、一般的な ARM スマートフォン向けのオンライン利用版ではありません。エミュレーターとメモリ内の模擬 RPC による検証は、実際のエンドツーエンド検証ではありません。

## 接続の仕組み

以下は目標とする通信経路です。実ネットワークでの結合検証は未完了です。

```text
Android ネイティブ Pi Web 画面
  ↕ Remote Noise 暗号化チャネル（P2P / TURN / Relay）
独立 Pi Web Host
  ↕ 制限付き HTTP / SSE、固定宛先 127.0.0.1:30141
既存の Pi Web + 最小ブリッジ変更
  ↕ 元の SDK / Agent インスタンス
元のセッション、ツール、タスク
```

Host はモデルを実行せず、元の DSH Host runtime を起動せず、Pi Web を ACP backend として扱いません。Pi Web と質問プラグインにも対応するブリッジ変更が必要です。本リポジトリには[移植用パッチと実行記録](docs/pi-web-remote/MINIMAL-BRIDGE-RESULTS.md)がありますが、これらの変更は本番環境に導入していません。

## 開発を始めるには

カスタマイズされたソースは開発ブランチ [`m2/pi-web-remote`](https://github.com/DreamCatcher096/ds-harness-remote/tree/m2/pi-web-remote) にあります。fork の `main` は本プロジェクトのカスタマイズ版ではありません。

```sh
git clone --branch m2/pi-web-remote --single-branch https://github.com/DreamCatcher096/ds-harness-remote.git pi-web-remote
cd pi-web-remote
```

この操作はソースの取得のみで、依存関係のインストール、アカウント登録、サービス起動は行いません。開発前に次を確認してください。

- [プロジェクト入口と現在の状況](docs/pi-web-remote/README.md)
- [実装計画](docs/pi-web-remote/IMPLEMENTATION-PLAN.md)と[受け入れ検証の範囲](docs/pi-web-remote/ACCEPTANCE.md)
- [ネイティブチャット・質問フォームの設計判断](docs/pi-web-remote/P3-ADR.md)、[Host 設計](docs/pi-web-remote/HOST-ADR.md)、[通信プロトコル](docs/protocol.md)
- [ソースの由来と固定バージョン](docs/pi-web-remote/SOURCE-BASELINE.md)
- [開発・セキュリティ規約](AGENTS.md)

詳細な開発文書は現在、主に中国語です。主要コードは、独立 Host が `apps/pi-web-host/`、Android が `apps/android/`、プロトコルとクライアント状態機械が `packages/protocol/` と `packages/client-core/`、対応ブリッジパッチが `docs/pi-web-remote/patches/` にあります。

保持している他のサブプロジェクトや過去の文書には、上流 DSH Remote の機能、インストール、リリース手順が記載されている場合があります。それらは Pi Web Remote の利用可能性の保証やワンコマンドインストール手順ではありません。

## セキュリティと開発上の境界

- 新しい Host／アプリは独立した識別情報を使い、既存 DSH のデバイス識別情報、秘密鍵、ログイン状態を流用しません。
- Pi Web の宛先は `127.0.0.1:30141` に固定します。任意の LAN、CONNECT、汎用 TCP プロキシに拡張せず、ネットワーク越しの業務通信を平文にフォールバックさせません。
- 切断、画面からの離脱、再接続で、プロンプト、質問フォームの回答などの書き込みを自動再送せず、元タスクも自動停止しません。
- ログインはユーザー自身が行い、実際の操作テストは一項目ずつ確認します。Issue、ログ、リポジトリに token、Cookie、秘密鍵、セッションファイル、会話全文を含めないでください。
- 設定の分離は OS サンドボックスではありません。将来の埋め込み Web 入口は Pi Web 自体の権限を持ち、ネイティブボタンを隠しても権限分離にはなりません。

## 上流への帰属とライセンス

本プロジェクトは [liguobao/ds-harness-remote](https://github.com/liguobao/ds-harness-remote) の fork で、開発基準は [`0a0ac9a1a647a171b79b19998d24bdd43bae9ea0`](https://github.com/liguobao/ds-harness-remote/tree/0a0ac9a1a647a171b79b19998d24bdd43bae9ea0) に固定しています。プロトコル、暗号化、通信、Android UI の基盤を提供した上流作者と貢献者に感謝します。

[MIT ライセンス](LICENSE)と元の著作権表示 `Copyright (c) 2026 DSH Remote contributors` を維持します。各サブモジュール・第三者コンポーネントのライセンスと NOTICE も遵守する必要があり、README の書き換えによってこれらの義務は変わりません。

Pi Web Remote は独立した派生プロジェクトであり、DSH Remote、Pi Web、DeepSeek の公式リリースや推奨を示すものではありません。名称と商標は各権利者に帰属します。
