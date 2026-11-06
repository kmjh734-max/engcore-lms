import type { Metadata } from "next";
import type { CSSProperties } from "react";
import {
  CANONICAL_SITE_URL,
  PRIMARY_COLOR,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/branding";
import "./fonts/pretendard/pretendardvariable-dynamic-subset.css";
// 인쇄 자료 글꼴: 조각내지 않은 한 파일·고정 굵기(인쇄 스풀링이 느리던 원인 — 2026-11-06)
import "./fonts/print-fonts.css";
import "./globals.css";
import { PrintFlatten } from "@/components/print/PrintFlatten";

const SHARE_IMAGE = "/og/engcore-share.png";

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: CANONICAL_SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    // 카카오톡·메신저 링크 미리보기용 EngCore 대표 이미지 (1200×630)
    images: [
      {
        url: SHARE_IMAGE,
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} · 영어학원의 모든 것을 하나로`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeStyle = {
    "--academy-primary": PRIMARY_COLOR,
    "--academy-secondary": PRIMARY_COLOR,
  } as CSSProperties;

  return (
    <html lang="ko">
      <body style={themeStyle}>
        {children}
        <PrintFlatten />
      </body>
    </html>
  );
}
