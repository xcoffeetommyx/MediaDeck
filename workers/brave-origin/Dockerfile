FROM ghcr.io/linuxserver/brave@sha256:231ef3faa6ca23caae36708aab3c40af3a3d2ef0e684ab43fa5b444267cba039

COPY disable-av1 /opt/mediadeck/extensions/disable-av1

RUN test -x /usr/bin/brave-origin \
    && test -f /usr/lib/x86_64-linux-gnu/dri/i965_drv_video.so \
    && test -f /usr/lib/x86_64-linux-gnu/dri/iHD_drv_video.so \
    && command -v vainfo >/dev/null \
    && chmod -R a=rX /opt/mediadeck/extensions/disable-av1
