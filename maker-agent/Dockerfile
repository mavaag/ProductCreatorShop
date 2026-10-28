# MakerProducts-agent: Claude Code + de Python-tooling voor laserplaten en productdocumenten.
# De code van de agent zelf (agent.py, jobctl.py, AGENT_PROMPT.md) wordt niet in de image gebakken maar uit de
# repo gemount (/src, bijgehouden door auto-deploy), zodat een merge op master volstaat om ze bij te werken.
FROM node:22-bookworm-slim

# non-free aanzetten voor unrar: het Debian-pakket 7zip kan om licentieredenen geen RAR uitpakken
RUN sed -i 's/^Components: main$/Components: main non-free/' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv inkscape git ca-certificates curl 7zip unzip unrar \
      libvulkan1 mesa-vulkan-drivers libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Real-ESRGAN (ncnn/Vulkan) om Wall Art-prints met een te lage resolutie te vergroten (tools/maker/upscale_print.py).
# Vulkan via de Intel-GPU van de NAS (/dev/dri, zie docker-compose.yml); zonder GPU valt Mesa terug op de CPU (traag).
# Vaste release + sha256: de zip wordt enkel gebruikt als hij exact deze inhoud heeft.
ARG REALESRGAN_URL=https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip
ARG REALESRGAN_SHA256=e5aa6eb131234b87c0c51f82b89390f5e3e642b7b70f2b9bbe95b6a285a40c96
RUN curl -fsSL -o /tmp/realesrgan.zip "$REALESRGAN_URL" \
    && echo "$REALESRGAN_SHA256  /tmp/realesrgan.zip" | sha256sum -c - \
    && mkdir -p /opt/realesrgan \
    && unzip -q /tmp/realesrgan.zip realesrgan-ncnn-vulkan 'models/realesrgan-x4plus*' -d /opt/realesrgan \
    && chmod 755 /opt/realesrgan/realesrgan-ncnn-vulkan && rm /tmp/realesrgan.zip

# vaste versies: een nieuwere release kan de nesting/conversie anders laten uitkomen
RUN pip3 install --no-cache-dir --break-system-packages \
      numpy==2.3.4 scipy==1.16.3 shapely==2.1.2 ezdxf==1.4.3 svgelements==1.9.6 \
      matplotlib==3.10.7 pillow==12.0.0 pymupdf==1.26.5 pypdfium2==4.30.0

ARG CLAUDE_CODE_VERSION=2.1.310
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

# zelfde uid/gid als de NAS-gebruiker mavaag, zodat nieuwe bestanden in MakerProducts van hem zijn
RUN groupmod -g 1001 node && usermod -u 1001 node \
    && (getent group users || groupadd -g 100 users) \
    && useradd -m -u 1000 -g 100 -s /bin/bash agent
USER agent
WORKDIR /home/agent
ENV PYTHONIOENCODING=utf-8 PYTHONUNBUFFERED=1 MPLBACKEND=Agg DISABLE_AUTOUPDATER=1

CMD ["/bin/sh", "-c", "while true; do python3 /src/maker-agent/agent.py; sleep 10; done"]
