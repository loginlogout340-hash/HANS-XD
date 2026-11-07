FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 ffmpeg curl fontconfig fonts-dejavu-core fonts-noto-color-emoji \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) the files of this repo
COPY . /app/

# 2) code.js was uploaded with the wrong name; the bot needs codes.js
RUN if [ ! -f codes.js ] && [ -f code.js ]; then mv code.js codes.js; fi

# 3) the base files (commands.js, extra.js, media.js, ...) live in the Hans-Mini repo.
#    Anything this repo does not have is copied from there; files that exist here always win.
ARG BASE_REPO=https://github.com/loginlogout340-hash/hans-mini.git
ARG BASE_REF=main
RUN git clone --depth 1 --branch "$BASE_REF" "$BASE_REPO" /tmp/base \
    && for f in /tmp/base/*; do n=$(basename "$f"); [ -e "/app/$n" ] || cp -r "$f" "/app/$n"; done \
    && rm -rf /tmp/base

# 4) stop the build with a clear message if something is still missing
RUN for f in index.js gate.js bot.js manager.js server.js commands.js extra.js media.js status.js ui.js usage.js limit.js hanson.js community.js dl.js admin.js page.js momo.js codes.js accounts.js acctpage.js pulse.js pulsepage.js more.js more2.js more3.js more5.js more6.js xd1.js xd2.js xd3.js xd4.js xd5.js xdutil.js package.json; do \
      [ -f "$f" ] || { echo "BUILD STOPPED: $f is missing"; exit 1; }; \
    done

RUN npm install --omit=dev

CMD ["node", "index.js"]
