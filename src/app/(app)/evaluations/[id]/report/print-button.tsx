"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export function PrintButton() {
  return (
    <Button
      size="sm"
      onClick={() => {
        if (typeof window !== "undefined") {
          window.print();
        }
      }}
    >
      <Download className="mr-2 h-4 w-4" />
      Download PDF
    </Button>
  );
}
