import { EnglishKeypad } from "@/components/ui/EnglishKeypad";

/** 로그인 없이 여는 단어학습(시험지·중학교 QR): 답 칸은 휴대폰 키보드 대신 화면 자판을 쓴다 */
export default function ExamVocabLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <EnglishKeypad />
    </>
  );
}
