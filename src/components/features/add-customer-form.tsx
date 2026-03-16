"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";

interface AddCustomerFormProps {
  onSuccess: () => void;
}

export default function AddCustomerForm({ onSuccess }: AddCustomerFormProps) {
  const [formData, setFormData] = useState({
    name: "",
    industry: "",
    pdContractRenewal: "",
    notes: "",
  });

  const { toast } = useToast();
  const createMutation = trpc.customer.create.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await createMutation.mutateAsync({
        name: formData.name,
        industry: formData.industry || undefined,
        pdContractRenewal: formData.pdContractRenewal
          ? new Date(formData.pdContractRenewal).toISOString()
          : undefined,
        notes: formData.notes || undefined,
      });

      toast({
        title: "Success",
        description: "Customer created successfully",
      });

      setFormData({
        name: "",
        industry: "",
        pdContractRenewal: "",
        notes: "",
      });

      onSuccess();
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to create customer",
        variant: "destructive",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Customer Name *</Label>
        <Input
          id="name"
          placeholder="e.g., Acme Corporation"
          value={formData.name}
          onChange={(e) =>
            setFormData({ ...formData, name: e.target.value })
          }
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="industry">Industry</Label>
        <Input
          id="industry"
          placeholder="e.g., Technology, Finance"
          value={formData.industry}
          onChange={(e) =>
            setFormData({ ...formData, industry: e.target.value })
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="pdContractRenewal">PD Contract Renewal Date</Label>
        <Input
          id="pdContractRenewal"
          type="date"
          value={formData.pdContractRenewal}
          onChange={(e) =>
            setFormData({ ...formData, pdContractRenewal: e.target.value })
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <textarea
          id="notes"
          placeholder="Additional notes about this customer"
          value={formData.notes}
          onChange={(e) =>
            setFormData({ ...formData, notes: e.target.value })
          }
          className="flex min-h-[80px] w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2"
        />
      </div>

      <Button
        type="submit"
        disabled={!formData.name || createMutation.isPending}
        className="w-full"
      >
        {createMutation.isPending ? "Creating..." : "Create Customer"}
      </Button>
    </form>
  );
}