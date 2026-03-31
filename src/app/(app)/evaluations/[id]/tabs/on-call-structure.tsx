"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Users, Calendar, GitBranch, Server } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Evaluation = any;

interface OnCallStructureTabProps {
  evaluation: Evaluation;
}

function formatRotation(seconds: number): string {
  if (!seconds) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0 && hours > 0) return `${days}d ${hours}h`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${seconds}s`;
}

function formatTimeout(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds === 0) return "Disabled";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export default function OnCallStructureTab({ evaluation }: OnCallStructureTabProps) {
  const [search, setSearch] = useState("");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const { data, isLoading } = trpc.evaluation.getOnCallStructure.useQuery(
    { id: evaluation.id },
    { enabled: !!evaluation.id }
  );

  const toggleExpand = (id: string) => {
    const next = new Set(expandedItems);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedItems(next);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-zinc-500">
        No config snapshot linked to this evaluation.
      </div>
    );
  }

  const { teams, escalationPolicies, schedules, services } = data;

  const filterBy = (name: string) =>
    name.toLowerCase().includes(search.toLowerCase());

  const filteredTeams = teams.filter((t) => filterBy(t.name));
  const filteredEPs = escalationPolicies.filter((e) => filterBy(e.name));
  const filteredSchedules = schedules.filter((s) => filterBy(s.name));
  const filteredServices = services.filter((s) => filterBy(s.name));

  return (
    <div className="space-y-4">
      {/* Search */}
      <Input
        placeholder="Search teams, schedules, escalation policies, services..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />

      {/* Summary counts */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Teams", count: teams.length, icon: Users, color: "text-blue-600" },
          { label: "Escalation Policies", count: escalationPolicies.length, icon: GitBranch, color: "text-purple-600" },
          { label: "Schedules", count: schedules.length, icon: Calendar, color: "text-green-600" },
          { label: "Services", count: services.length, icon: Server, color: "text-orange-600" },
        ].map(({ label, count, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2">
                <Icon className={`h-5 w-5 ${color}`} />
                <div>
                  <p className="text-2xl font-bold">{count}</p>
                  <p className="text-xs text-zinc-500">{label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="teams">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="teams">Teams ({filteredTeams.length})</TabsTrigger>
          <TabsTrigger value="escalation-policies">Escalation Policies ({filteredEPs.length})</TabsTrigger>
          <TabsTrigger value="schedules">Schedules ({filteredSchedules.length})</TabsTrigger>
          <TabsTrigger value="services">Services ({filteredServices.length})</TabsTrigger>
        </TabsList>

        {/* Teams Tab */}
        <TabsContent value="teams" className="space-y-2 mt-4">
          {filteredTeams.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">No teams found</p>
          ) : (
            filteredTeams.map((team) => (
              <Card key={team.id} className="overflow-hidden">
                <button
                  className="w-full text-left"
                  onClick={() => toggleExpand(`team-${team.id}`)}
                >
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      {expandedItems.has(`team-${team.id}`) ? (
                        <ChevronDown className="h-4 w-4 text-zinc-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-zinc-400" />
                      )}
                      <span className="font-medium text-sm">{team.name}</span>
                    </div>
                    <Badge variant="secondary">{team.members.length} members</Badge>
                  </div>
                </button>
                {expandedItems.has(`team-${team.id}`) && team.members.length > 0 && (
                  <div className="border-t border-zinc-100 px-4 pb-4 pt-2">
                    <div className="grid grid-cols-1 gap-1">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {team.members.map((m: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between py-1.5 border-b border-zinc-50 last:border-0">
                          <div>
                            <span className="text-sm font-medium">{m.name}</span>
                            {m.email && (
                              <span className="text-xs text-zinc-400 ml-2">{m.email}</span>
                            )}
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              m.role === "manager"
                                ? "border-blue-200 text-blue-700"
                                : m.role === "observer"
                                ? "border-zinc-200 text-zinc-500"
                                : "border-zinc-200 text-zinc-700"
                            }
                          >
                            {m.role}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            ))
          )}
        </TabsContent>

        {/* Escalation Policies Tab */}
        <TabsContent value="escalation-policies" className="space-y-2 mt-4">
          {filteredEPs.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">No escalation policies found</p>
          ) : (
            filteredEPs.map((ep) => (
              <Card key={ep.id} className="overflow-hidden">
                <button
                  className="w-full text-left"
                  onClick={() => toggleExpand(`ep-${ep.id}`)}
                >
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      {expandedItems.has(`ep-${ep.id}`) ? (
                        <ChevronDown className="h-4 w-4 text-zinc-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-zinc-400" />
                      )}
                      <span className="font-medium text-sm">{ep.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500">{ep.rules.length} rules</span>
                      {ep.numLoops > 0 && (
                        <Badge variant="outline" className="text-xs">
                          loops: {ep.numLoops}
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
                {expandedItems.has(`ep-${ep.id}`) && (
                  <div className="border-t border-zinc-100 px-4 pb-4 pt-2 space-y-3">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {ep.rules.map((rule: any) => (
                      <div key={rule.ruleNumber} className="flex gap-3">
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center font-semibold">
                          {rule.ruleNumber}
                        </div>
                        <div className="flex-1">
                          <p className="text-xs text-zinc-500 mb-1">
                            Escalates after {rule.escalationDelayMinutes}m
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {rule.targets.map((target: any, idx: number) => (
                              <Badge
                                key={idx}
                                variant="secondary"
                                className={target.isSchedule ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-700"}
                              >
                                {target.isSchedule ? "📅 " : "👤 "}{target.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))
          )}
        </TabsContent>

        {/* Schedules Tab */}
        <TabsContent value="schedules" className="space-y-2 mt-4">
          {filteredSchedules.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">No schedules found</p>
          ) : (
            filteredSchedules.map((schedule) => (
              <Card key={schedule.id} className="overflow-hidden">
                <button
                  className="w-full text-left"
                  onClick={() => toggleExpand(`sched-${schedule.id}`)}
                >
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      {expandedItems.has(`sched-${schedule.id}`) ? (
                        <ChevronDown className="h-4 w-4 text-zinc-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-zinc-400" />
                      )}
                      <span className="font-medium text-sm">{schedule.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500">{schedule.timeZone}</span>
                      <Badge variant="secondary">{schedule.layers.length} layer{schedule.layers.length !== 1 ? "s" : ""}</Badge>
                    </div>
                  </div>
                </button>
                {expandedItems.has(`sched-${schedule.id}`) && (
                  <div className="border-t border-zinc-100 px-4 pb-4 pt-2 space-y-3">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {schedule.layers.map((layer: any, idx: number) => (
                      <div key={idx} className="bg-zinc-50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium">{layer.name || `Layer ${idx + 1}`}</span>
                          <span className="text-xs text-zinc-500">
                            {formatRotation(layer.rotationTurnLengthSeconds)} rotation
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          {layer.users.map((user: any, uidx: number) => (
                            <Badge key={uidx} variant="outline" className="text-xs">
                              {user}
                            </Badge>
                          ))}
                        </div>
                        {layer.restrictions.length > 0 && (
                          <p className="text-xs text-zinc-400 mt-2">
                            {layer.restrictions.length} restriction{layer.restrictions.length !== 1 ? "s" : ""}
                          </p>
                        )}
                      </div>
                    ))}
                    {schedule.layers.length === 0 && (
                      <p className="text-sm text-zinc-400">No layers defined</p>
                    )}
                  </div>
                )}
              </Card>
            ))
          )}
        </TabsContent>

        {/* Services Tab */}
        <TabsContent value="services" className="space-y-2 mt-4">
          {filteredServices.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">No services found</p>
          ) : (
            filteredServices.map((svc) => (
              <Card key={svc.id} className="overflow-hidden">
                <button
                  className="w-full text-left"
                  onClick={() => toggleExpand(`svc-${svc.id}`)}
                >
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      {expandedItems.has(`svc-${svc.id}`) ? (
                        <ChevronDown className="h-4 w-4 text-zinc-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-zinc-400" />
                      )}
                      <span className="font-medium text-sm">{svc.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {svc.status !== "active" && (
                        <Badge variant="outline" className="text-orange-600 border-orange-200">
                          {svc.status}
                        </Badge>
                      )}
                      {svc.hasDependencies && (
                        <Badge variant="outline" className="text-purple-600 border-purple-200 text-xs">
                          has deps
                        </Badge>
                      )}
                      {svc.integrationCount > 0 && (
                        <span className="text-xs text-zinc-500">{svc.integrationCount} integrations</span>
                      )}
                    </div>
                  </div>
                </button>
                {expandedItems.has(`svc-${svc.id}`) && (
                  <div className="border-t border-zinc-100 px-4 pb-4 pt-3">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div>
                        <span className="text-zinc-500">Escalation Policy</span>
                        <p className="font-medium">{svc.escalationPolicyName || "—"}</p>
                      </div>
                      <div>
                        <span className="text-zinc-500">Alert Grouping</span>
                        <p className="font-medium">{svc.alertGroupingType || "None"}</p>
                      </div>
                      <div>
                        <span className="text-zinc-500">Auto-Resolve</span>
                        <p className="font-medium">{formatTimeout(svc.autoResolveTimeout)}</p>
                      </div>
                      <div>
                        <span className="text-zinc-500">Ack Timeout</span>
                        <p className="font-medium">{formatTimeout(svc.acknowledgementTimeout)}</p>
                      </div>
                    </div>
                    {svc.dependsOn.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs text-zinc-500 mb-1.5">Depends on</p>
                        <div className="flex flex-wrap gap-1.5">
                          {svc.dependsOn.map((id: string) => (
                            <Badge key={id} variant="outline" className="text-xs">
                              {filteredServices.find((s) => s.id === id)?.name ?? id}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {svc.dependedOnBy.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs text-zinc-500 mb-1.5">Depended on by</p>
                        <div className="flex flex-wrap gap-1.5">
                          {svc.dependedOnBy.map((id: string) => (
                            <Badge key={id} variant="outline" className="text-xs text-purple-600 border-purple-200">
                              {filteredServices.find((s) => s.id === id)?.name ?? id}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
