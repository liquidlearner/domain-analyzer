"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";

interface DomainConnectFormProps {
  customerId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

type Step = "subdomain" | "token" | "validate";

export default function DomainConnectForm({
  customerId,
  onSuccess,
  onCancel,
}: DomainConnectFormProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<Step>("subdomain");
  const [subdomain, setSubdomain] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const { toast } = useToast();
  const connectMutation = trpc.domain.connect.useMutation();

  const handleSubdomainNext = () => {
    if (!subdomain.trim()) {
      toast({
        title: "Error",
        description: "Please enter a subdomain",
        variant: "destructive",
      });
      return;
    }
    setCurrentStep("token");
  };

  const handleTokenNext = () => {
    if (!apiToken.trim()) {
      toast({
        title: "Error",
        description: "Please enter an API token",
        variant: "destructive",
      });
      return;
    }
    setCurrentStep("validate");
  };

  const handleConnect = async () => {
    try {
      const result = await connectMutation.mutateAsync({
        customerId,
        subdomain: subdomain.trim(),
        apiToken: apiToken.trim(),
      });

      toast({
        title: "Domain connected",
        description: "Redirecting to domain page — sync config to pull resources",
      });

      onSuccess();
      router.push(`/domains/${result.id}`);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to connect domain",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Step 1: Subdomain */}
      <div className={currentStep === "subdomain" ? "block" : "hidden"}>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="subdomain">PagerDuty Subdomain</Label>
            <div className="flex gap-1">
              <Input
                id="subdomain"
                placeholder="e.g., acme-corp"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") handleSubdomainNext();
                }}
                autoFocus
              />
              <span className="flex items-center text-sm text-zinc-500 px-2">
                .pagerduty.com
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              Enter your PagerDuty account subdomain
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubdomainNext}
              className="flex-1"
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* Step 2: Token */}
      <div className={currentStep === "token" ? "block" : "hidden"}>
        <div className="space-y-3">
          <Card className="p-3 bg-blue-50 border-blue-200">
            <p className="text-sm text-blue-900">
              Subdomain: <span className="font-semibold">{subdomain}.pagerduty.com</span>
            </p>
          </Card>

          <div className="space-y-2">
            <Label htmlFor="apiToken">PagerDuty API Token</Label>
            <div className="relative">
              <Input
                id="apiToken"
                type={showToken ? "text" : "password"}
                placeholder="Enter your read-only API token"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") handleTokenNext();
                }}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-2.5 text-sm text-zinc-500 hover:text-zinc-700"
              >
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              Use a read-only API token for security. Get it from PagerDuty Settings.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentStep("subdomain")}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              type="button"
              onClick={handleTokenNext}
              className="flex-1"
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* Step 3: Validate & Connect */}
      <div className={currentStep === "validate" ? "block" : "hidden"}>
        <div className="space-y-3">
          <Card className="p-3 bg-blue-50 border-blue-200 space-y-2">
            <p className="text-sm text-blue-900">
              Subdomain: <span className="font-semibold">{subdomain}.pagerduty.com</span>
            </p>
            <p className="text-sm text-blue-900">
              Token: <span className="font-semibold font-mono">••••{apiToken.slice(-4)}</span>
            </p>
          </Card>

          <div className="space-y-2">
            <p className="text-sm text-zinc-700">
              Click "Connect" to validate and connect this domain.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentStep("token")}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              type="button"
              onClick={handleConnect}
              disabled={connectMutation.isPending}
              className="flex-1"
            >
              {connectMutation.isPending ? "Connecting..." : "Connect"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}