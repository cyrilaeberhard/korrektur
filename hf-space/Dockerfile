FROM eclipse-temurin:17-jre
RUN apt-get update && apt-get install -y --no-install-recommends python3 curl unzip \
    && rm -rf /var/lib/apt/lists/*
ARG LT_VERSION=6.8
RUN curl -fsSL -o /tmp/lt.zip https://languagetool.org/download/LanguageTool-${LT_VERSION}.zip \
    && unzip -q /tmp/lt.zip -d /opt && mv /opt/LanguageTool-${LT_VERSION} /opt/languagetool && rm /tmp/lt.zip
WORKDIR /app
COPY server.py supplemental_grammar.py start.sh /app/
RUN chmod +x /app/start.sh
# Hugging Face Spaces startet den Container als Nutzer 1000
RUN useradd -m -u 1000 user
USER user
EXPOSE 7860
CMD ["/app/start.sh"]
