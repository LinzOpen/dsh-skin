#!/bin/sh
# 把三个包按依赖顺序发到 npm。core 先发，cli / electron 依赖它。
# 幂等：某个版本已经发过，npm 会报 E403/EPUBLISHCONFLICT，脚本继续下一个。
#
# 前提：先在这台机器上登录过 npm（`npm login`，走浏览器授权，一次即可）。
# 用法：sh scripts/publish-npm.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
for pkg in packages/core packages/cli packages/electron; do
  name=$(node -p "require('$ROOT/$pkg/package.json').name")
  ver=$(node -p "require('$ROOT/$pkg/package.json').version")
  echo "── $name@$ver"
  if npm view "$name@$ver" version >/dev/null 2>&1; then
    echo "   已存在，跳过"
    continue
  fi
  (cd "$ROOT/$pkg" && npm publish)
  echo "   ✓ 已发布"
done
echo "全部完成。core 是主包：npm i css-guard"
