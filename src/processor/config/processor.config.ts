export const VideoProcessorConfiguration = {
  retryDelayMs: 60000,
  maxRetryCount: 5,
};

export const GeneratorConfiguration = {
  device: 0,
  hardwareAcceleration: {
    hardwareAccelerator: 'auto',
    decoder: 'h264_cuvid',
    encoder: 'h264_nvenc',
  },
};

export const ThumbnailConfiguration = {
  thumbnailHeight: 360,
  thumbnailPositions: [
    { seconds: 5 },
    { timePercentage: 0.15 },
    { timePercentage: 0.3 },
  ],
};

export const VideoProcessingSteps = [
  { label: '144p', height: 144, bitrate: 600 },
  { label: '240p', height: 240, bitrate: 1000 },
  { label: '360p', height: 360, bitrate: 1400 },
  { label: '480p', height: 480, bitrate: 1800 },
  { label: '720p', height: 720, bitrate: 4000 },
  { label: '1080p', height: 1080, bitrate: 10000 },
  { label: '1440p', height: 1440, bitrate: 20000 },
  { label: '2160p', height: 2160, bitrate: 50000 },
  { label: '4320p', height: 4320, bitrate: 100000 },
];
