#!/bin/bash
# blogctl 데이터를 대시보드 프로젝트로 동기화
# 사용법: ./scripts/sync-data.sh

SRC="/mnt/c/jin/projects/my-resume/blogs/scripts"
DEST="$(dirname "$0")/../data"

mkdir -p "$DEST"

cp "$SRC/publish_log.json" "$DEST/"
cp "$SRC/measurement_log.json" "$DEST/"
cp "$SRC/keyword_predictions.json" "$DEST/"
cp "$SRC/"*_keyword_pool.json "$DEST/"
cp "$SRC/keyword_pool.json" "$DEST/"

echo "Synced $(ls "$DEST"/*.json | wc -l) files to data/"
echo "Run 'vercel' or 'git push' to deploy with fresh data"
