#!/bin/bash
# ITC TRPG — 빌드 스크립트
# dev/ 소스 파일을 합쳐서 브라우저용 파일 생성
#
# 사용법:
#   chmod +x build.sh
#   ./build.sh

set -e
cd "$(dirname "$0")"

echo "🔨 Building..."

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
    dev/chat-v1/_chat-avatar.js \
    dev/chat-v1/_chat-message.js \
    > src/modules/chat-v1/chat.js

cat dev/map-token/_map-viewport.js \
    dev/map-token/_map-render.js \
    dev/map-token/_token-edit.js \
    > src/modules/map-token/map-token.js

cat dev/journal-v1/_journal-base.js \
    dev/journal-v1/_journal-core.js \
    dev/journal-v1/_journal-sheet.js \
    > src/modules/journal-v1/journal.js

echo "✅ Build complete"
echo "   chat.js      $(wc -l < src/modules/chat-v1/chat.js) lines"
echo "   map-token.js  $(wc -l < src/modules/map-token/map-token.js) lines"
echo "   journal.js    $(wc -l < src/modules/journal-v1/journal.js) lines"
