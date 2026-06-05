#!/bin/bash
# ITC TRPG — 빌드 스크립트
# dev/ 소스 파일을 합쳐서 브라우저용 파일 생성
#
# 사용법:
#   chmod +x build.sh
#   ./build.sh chat      # chat-v1만 빌드
#   ./build.sh all       # 전체 빌드. dev/src 불일치가 있으면 기본 차단
#
# 주의:
#   2026-06 기준 chat-v1은 dev/src 동기화 완료 상태입니다.
#   map-token 등 다른 모듈의 dev/src가 불일치하면 전체 빌드는 회귀를 만들 수 있으므로
#   기본적으로 guard가 전체 빌드를 차단합니다.
#   의도적으로 전체 빌드를 강행해야 하는 경우에만 아래처럼 실행하세요.
#   ITC_ALLOW_UNSYNCED_BUILD=1 ./build.sh all

set -e
cd "$(dirname "$0")"

TARGET="${1:-all}"
ALLOW_UNSYNCED="${ITC_ALLOW_UNSYNCED_BUILD:-0}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

build_chat_tmp() {
  cat dev/chat-v1/_chat-input.js \
      dev/chat-v1/_chat-render-state.js \
      dev/chat-v1/_chat-render-virtual.js \
      dev/chat-v1/_chat-store.js \
      dev/chat-v1/_chat-render.js \
      dev/chat-v1/_chat-history.js \
      dev/chat-v1/_chat-image-display.js \
      dev/chat-v1/_chat-image-queue.js \
      dev/chat-v1/_chat-image-prepare.js \
      dev/chat-v1/_chat-image-upload.js \
      dev/chat-v1/_chat-image.js \
      dev/chat-v1/_chat-send.js \
      dev/chat-v1/_chat-send-message.js \
      dev/chat-v1/_chat-casual-state.js \
      dev/chat-v1/_chat-typing.js \
      dev/chat-v1/_chat-actions.js \
      dev/chat-v1/_chat-casual-render.js \
      dev/chat-v1/_chat-whisper.js \
      dev/chat-v1/_chat-lightbox.js \
      dev/chat-v1/_chat-avatar.js \
      dev/chat-v1/_chat-message.js \
      > "$1"
}

build_map_tmp() {
  cat dev/map-token/_map-viewport.js \
      dev/map-token/_map-render.js \
      dev/map-token/_token-edit.js \
      > "$1"
}

build_journal_tmp() {
  cat dev/journal-v1/_journal-base.js \
      dev/journal-v1/_journal-core.js \
      dev/journal-v1/_journal-sheet.js \
      > "$1"
}

assert_synced_or_abort() {
  local label="$1"
  local generated="$2"
  local current="$3"
  if ! cmp -s "$generated" "$current"; then
    echo "🚫 Build aborted: $label dev/src 불일치가 감지되었습니다."
    echo "   generated: $(wc -l < "$generated") lines"
    echo "   current:   $(wc -l < "$current") lines"
    echo ""
    echo "   이 상태에서 전체 build를 실행하면 현재 런타임 코드가 dev 코드로 덮여 회귀가 생길 수 있습니다."
    echo "   chat만 빌드하려면: ./build.sh chat"
    echo "   정말 전체 빌드를 강행하려면: ITC_ALLOW_UNSYNCED_BUILD=1 ./build.sh all"
    exit 1
  fi
}

build_chat() {
  build_chat_tmp "$TMP_DIR/chat.js"
  cp "$TMP_DIR/chat.js" src/modules/chat-v1/chat.js
  echo "   chat.js      $(wc -l < src/modules/chat-v1/chat.js) lines"
}

build_map() {
  build_map_tmp "$TMP_DIR/map-token.js"
  cp "$TMP_DIR/map-token.js" src/modules/map-token/map-token.js
  echo "   map-token.js  $(wc -l < src/modules/map-token/map-token.js) lines"
}

build_journal() {
  build_journal_tmp "$TMP_DIR/journal.js"
  cp "$TMP_DIR/journal.js" src/modules/journal-v1/journal.js
  echo "   journal.js    $(wc -l < src/modules/journal-v1/journal.js) lines"
}

case "$TARGET" in
  chat)
    echo "🔨 Building chat-v1 only..."
    build_chat
    echo "✅ Chat build complete"
    ;;
  all)
    echo "🔎 Checking full-build safety..."
    build_chat_tmp "$TMP_DIR/chat.js"
    build_map_tmp "$TMP_DIR/map-token.js"
    build_journal_tmp "$TMP_DIR/journal.js"

    if [ "$ALLOW_UNSYNCED" != "1" ]; then
      assert_synced_or_abort "chat-v1" "$TMP_DIR/chat.js" src/modules/chat-v1/chat.js
      assert_synced_or_abort "map-token" "$TMP_DIR/map-token.js" src/modules/map-token/map-token.js
      assert_synced_or_abort "journal-v1" "$TMP_DIR/journal.js" src/modules/journal-v1/journal.js
    else
      echo "⚠️  ITC_ALLOW_UNSYNCED_BUILD=1 감지: dev/src 불일치 guard를 우회합니다."
    fi

    echo "🔨 Building all modules..."
    cp "$TMP_DIR/chat.js" src/modules/chat-v1/chat.js
    cp "$TMP_DIR/map-token.js" src/modules/map-token/map-token.js
    cp "$TMP_DIR/journal.js" src/modules/journal-v1/journal.js
    echo "✅ Build complete"
    echo "   chat.js      $(wc -l < src/modules/chat-v1/chat.js) lines"
    echo "   map-token.js  $(wc -l < src/modules/map-token/map-token.js) lines"
    echo "   journal.js    $(wc -l < src/modules/journal-v1/journal.js) lines"
    ;;
  *)
    echo "사용법: ./build.sh chat | all"
    exit 1
    ;;
esac
