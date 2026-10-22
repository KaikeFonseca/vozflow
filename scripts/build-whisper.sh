#!/usr/bin/env bash
# Compila o whisper-server (whisper.cpp) e baixa o modelo padrão para dentro do app.
# Uso: scripts/build-whisper.sh <win|mac|linux> <x64|arm64>
# Resultado: bin/<os>-<arch>/whisper-server[.exe] e models/ggml-small-q5_1.bin
set -euo pipefail

OS="$1"
ARCH="$2"
WHISPER_TAG="${WHISPER_TAG:-v1.9.5}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/.whisper-src"
OUT="$ROOT/bin/$OS-$ARCH"
BUILD="$ROOT/.whisper-build-$OS-$ARCH"

if [ ! -d "$SRC" ]; then
  git clone --depth 1 --branch "$WHISPER_TAG" https://github.com/ggml-org/whisper.cpp "$SRC"
fi

# Binário portátil: sem otimizar para a CPU da máquina de build, sem DLLs extras.
FLAGS=(
  -DCMAKE_BUILD_TYPE=Release
  -DBUILD_SHARED_LIBS=OFF
  -DWHISPER_BUILD_TESTS=OFF
  -DWHISPER_BUILD_SERVER=ON
  -DWHISPER_SDL2=OFF
  -DGGML_NATIVE=OFF
  -DGGML_OPENMP=OFF
)
X86=(-DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON)

case "$OS-$ARCH" in
  win-x64)
    FLAGS+=("${X86[@]}" -DCMAKE_POLICY_DEFAULT_CMP0091=NEW -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded)
    ;;
  mac-arm64)
    FLAGS+=(-DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON)
    ;;
  mac-x64)
    FLAGS+=("${X86[@]}" -DCMAKE_OSX_ARCHITECTURES=x86_64 -DCMAKE_SYSTEM_PROCESSOR=x86_64 -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 -DGGML_METAL=OFF)
    ;;
  linux-x64)
    FLAGS+=("${X86[@]}")
    ;;
  *)
    echo "Combinação não suportada: $OS-$ARCH" >&2
    exit 1
    ;;
esac

cmake -S "$SRC" -B "$BUILD" "${FLAGS[@]}"
cmake --build "$BUILD" --config Release --target whisper-server -j 4

mkdir -p "$OUT"
EXE=whisper-server
[ "$OS" = win ] && EXE=whisper-server.exe
BIN="$(find "$BUILD" -name "$EXE" -type f | head -1)"
cp "$BIN" "$OUT/$EXE"
chmod +x "$OUT/$EXE"
echo "whisper-server -> $OUT/$EXE"

MODEL="$ROOT/models/ggml-small-q5_1.bin"
if [ ! -f "$MODEL" ]; then
  mkdir -p "$ROOT/models"
  curl -fL --retry 3 -o "$MODEL" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin
fi
ls -la "$OUT" "$ROOT/models"
