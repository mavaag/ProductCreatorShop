# MakerProducts-agent: Claude Code + de Python-tooling voor laserplaten en productdocumenten.
# De code van de agent zelf (agent.py, jobctl.py, AGENT_PROMPT.md) wordt niet in de image gebakken maar uit de
# repo gemount (/src, bijgehouden door auto-deploy), zodat een merge op master volstaat om ze bij te werken.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv inkscape git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

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
