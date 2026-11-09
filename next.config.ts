import type { NextConfig } from "next";

const pdfTracePaths = [
  "./node_modules/pdf-parse/**/*",
  "./node_modules/pdfjs-dist/**/*",
  "./node_modules/@napi-rs/canvas/**/*",
];

const comicTracePaths = [
  "./assets/fonts/**/*",
  "./public/fonts/**/*",
  "./node_modules/@napi-rs/canvas/**/*",
  "./node_modules/sharp/**/*",
  "./node_modules/@img/**/*",
];

const nextConfig: NextConfig = {
  // 열어 둔 탭이 예전 배포의 코드인지 가린다(use-reload-on-new-deploy).
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  serverExternalPackages: [
    "@ffmpeg-installer/ffmpeg",
    "@napi-rs/canvas",
    "sharp",
    "pdf-parse",
    "pdfjs-dist",
    // PDF 저장(/api/pdf/render): 서버리스 Chrome
    "@sparticuz/chromium",
    "puppeteer-core",
  ],
  outputFileTracingIncludes: {
    "/api/student-records/extract": pdfTracePaths,
    "/api/student-records/analyze": pdfTracePaths,
    "/api/lesson-materials/illustration": comicTracePaths,
    "/admin/lesson-materials/input": comicTracePaths,
    "/teacher/lesson-materials/input": comicTracePaths,
    "/admin/lesson-materials/project/[projectId]": comicTracePaths,
    "/teacher/lesson-materials/project/[projectId]": comicTracePaths,
    // pdfjs: 만든 PDF에서 빈 「(계속)」 쪽 찾기(일꾼 파일은 실행 중에 불러와 추적되지 않는다)
    "/api/pdf/render": ["./node_modules/@sparticuz/chromium/bin/**/*", "./node_modules/pdfjs-dist/legacy/build/**/*"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "i.vimeocdn.com" },
    ],
  },
};

export default nextConfig;
