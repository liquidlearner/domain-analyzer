import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Evaluation Report | PD Migration Analyzer",
};

export default function ReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`
        @media print {
          * {
            margin: 0;
            padding: 0;
            border: none;
          }

          html, body {
            width: 100%;
            height: 100%;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 10pt;
            line-height: 1.4;
            color: #1f2937;
            background: white;
          }

          .no-print {
            display: none !important;
          }

          .page-break {
            page-break-after: always;
          }

          @page {
            size: A4;
            margin: 1in;
          }
        }

        @media screen {
          .page-break {
            margin-bottom: 2rem;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 2rem;
          }
        }
      `}</style>
      {children}
    </>
  );
}
