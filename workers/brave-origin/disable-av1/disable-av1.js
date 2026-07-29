(() => {
  'use strict';

  const isAv1 = (value) => typeof value === 'string' && /\b(?:av01|av1)\b/i.test(value);

  const mediaSource = globalThis.MediaSource;
  if (mediaSource?.isTypeSupported) {
    const originalMediaSourceSupport = mediaSource.isTypeSupported.bind(mediaSource);
    mediaSource.isTypeSupported = (type) =>
      isAv1(type) ? false : originalMediaSourceSupport(type);
  }

  const mediaElement = globalThis.HTMLMediaElement;
  const originalCanPlayType = mediaElement.prototype.canPlayType;
  mediaElement.prototype.canPlayType = function (type) {
    return isAv1(type) ? '' : originalCanPlayType.call(this, type);
  };

  const mediaCapabilities = globalThis.navigator.mediaCapabilities;
  if (mediaCapabilities?.decodingInfo) {
    const originalDecodingInfo = mediaCapabilities.decodingInfo.bind(mediaCapabilities);
    Object.defineProperty(mediaCapabilities, 'decodingInfo', {
      configurable: true,
      value: async (configuration) => {
        const contentType =
          configuration?.video?.contentType ?? configuration?.audio?.contentType;
        if (isAv1(contentType)) {
          return { supported: false, smooth: false, powerEfficient: false };
        }
        return originalDecodingInfo(configuration);
      },
    });
  }
})();
