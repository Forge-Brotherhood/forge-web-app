"use client";

import { useState, useEffect } from "react";
import { Archive, CheckCircle2, Circle, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface Prayer {
  id: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  status: "active" | "answered" | "archived";
  prayerCount: number;
  encouragementCount: number;
  isPrivate: boolean;
  tags: string[];
  updates: Array<{
    id: string;
    content: string;
    createdAt: Date;
  }>;
}

const mockPrayers: Prayer[] = [
  {
    id: "p1",
    content: "Lord, help me find clarity in my career path. I'm at a crossroads and need Your guidance on which direction to take.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7), // 7 days ago
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
    status: "active",
    prayerCount: 24,
    encouragementCount: 8,
    isPrivate: false,
    tags: ["career", "guidance"],
    updates: [
      {
        id: "u1",
        content: "Had a great conversation with a mentor today. Feeling more peaceful about the decision.",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2),
      },
    ],
  },
  {
    id: "p2",
    content: "Thank You God! My sister's surgery was successful and she's recovering well. Your faithfulness is amazing!",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14), // 14 days ago
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5), // 5 days ago
    status: "answered",
    prayerCount: 67,
    encouragementCount: 23,
    isPrivate: false,
    tags: ["health", "family", "praise"],
    updates: [
      {
        id: "u2",
        content: "Surgery went perfectly! Doctors are amazed at how well it went.",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10),
      },
      {
        id: "u3",
        content: "She's home and recovering. God is so good!",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5),
      },
    ],
  },
  {
    id: "p3",
    content: "Struggling with forgiveness towards someone who hurt me deeply. I know I need to forgive but it's so hard.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30), // 30 days ago
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
    status: "active",
    prayerCount: 45,
    encouragementCount: 19,
    isPrivate: true,
    tags: ["relationships", "forgiveness"],
    updates: [],
  },
];

type FilterStatus = "all" | "active" | "answered" | "archived";

export default function YourPrayers() {
  const [prayers, setPrayers] = useState<Prayer[]>(mockPrayers);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);


  const handleStatusChange = (id: string, newStatus: Prayer["status"]) => {
    setPrayers(prayers.map(p => 
      p.id === id ? { ...p, status: newStatus, updatedAt: new Date() } : p
    ));
  };

  const filteredPrayers = prayers.filter(prayer => {
    const matchesSearch = !searchQuery || 
      prayer.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prayer.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesFilter = filterStatus === "all" || prayer.status === filterStatus;
    
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: prayers.length,
    active: prayers.filter(p => p.status === "active").length,
    answered: prayers.filter(p => p.status === "answered").length,
    archived: prayers.filter(p => p.status === "archived").length,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-foreground mb-2">My Prayers</h1>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 mb-6">
          <Card 
            className={cn(
              "p-3 sm:p-4 text-center cursor-pointer transition-all duration-200",
              "bg-card/50 backdrop-blur-sm border-border/50",
              filterStatus === "all" && "bg-accent/20 text-accent border-accent/40"
            )}
            onClick={() => setFilterStatus("all")}
          >
            <p className={cn(
              "text-lg sm:text-2xl font-bold mb-0.5",
              filterStatus === "all" ? "text-accent" : "text-foreground"
            )}>{stats.total}</p>
            <p className={cn(
              "text-[10px] sm:text-xs",
              filterStatus === "all" ? "text-accent/80" : "text-muted-foreground"
            )}>Total</p>
          </Card>
          <Card 
            className={cn(
              "p-3 sm:p-4 text-center cursor-pointer transition-all duration-200",
              "bg-card/50 backdrop-blur-sm border-border/50",
              filterStatus === "active" && "bg-accent/20 text-accent border-accent/40"
            )}
            onClick={() => setFilterStatus("active")}
          >
            <p className={cn(
              "text-lg sm:text-2xl font-bold mb-0.5",
              filterStatus === "active" ? "text-accent" : "text-blue-600 dark:text-blue-400"
            )}>{stats.active}</p>
            <p className={cn(
              "text-[10px] sm:text-xs",
              filterStatus === "active" ? "text-accent/80" : "text-muted-foreground"
            )}>Active</p>
          </Card>
          <Card 
            className={cn(
              "p-3 sm:p-4 text-center cursor-pointer transition-all duration-200",
              "bg-card/50 backdrop-blur-sm border-border/50",
              filterStatus === "answered" && "bg-accent/20 text-accent border-accent/40"
            )}
            onClick={() => setFilterStatus("answered")}
          >
            <p className={cn(
              "text-lg sm:text-2xl font-bold mb-0.5",
              filterStatus === "answered" ? "text-accent" : "text-green-600 dark:text-green-400"
            )}>{stats.answered}</p>
            <p className={cn(
              "text-[10px] sm:text-xs",
              filterStatus === "answered" ? "text-accent/80" : "text-muted-foreground"
            )}>Answered</p>
          </Card>
          <Card 
            className={cn(
              "p-3 sm:p-4 text-center cursor-pointer transition-all duration-200",
              "bg-card/50 backdrop-blur-sm border-border/50",
              filterStatus === "archived" && "bg-accent/20 text-accent border-accent/40"
            )}
            onClick={() => setFilterStatus("archived")}
          >
            <p className={cn(
              "text-lg sm:text-2xl font-bold mb-0.5",
              filterStatus === "archived" ? "text-accent" : "text-gray-600 dark:text-gray-400"
            )}>{stats.archived}</p>
            <p className={cn(
              "text-[10px] sm:text-xs",
              filterStatus === "archived" ? "text-accent/80" : "text-muted-foreground"
            )}>Archived</p>
          </Card>
        </div>

        {/* Search */}
        <div className="relative mb-8">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            type="text"
            placeholder="Search your prayers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-12 bg-secondary/50 border-border/50 focus:border-accent/50 text-base"
          />
        </div>

        {/* Prayers List */}
        <div className="space-y-6">
          {filteredPrayers.map((prayer) => (
            <Card key={prayer.id} className="p-6 bg-card/50 backdrop-blur-sm border-border/50 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2">
                  <Badge
                    variant={
                      prayer.status === "answered" ? "default" :
                      prayer.status === "archived" ? "secondary" : "outline"
                    }
                    className={cn(
                      prayer.status === "answered" && "forge-success-subtle",
                      prayer.status === "archived" && "forge-muted-subtle"
                    )}
                  >
                    {prayer.status}
                  </Badge>
                  {prayer.isPrivate && (
                    <Badge variant="outline" className="text-xs">
                      Private
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {mounted ? formatDistanceToNow(prayer.createdAt, { addSuffix: true }) : "..."}
                </p>
              </div>

              <p className="text-foreground/90 leading-relaxed">{prayer.content}</p>

              {/* Updates */}
              {prayer.updates.length > 0 && (
                <div className="space-y-3">
                  {prayer.updates.map((update) => (
                    <div key={update.id} className="pl-4 border-l-2 border-accent/30 space-y-1">
                      <p className="text-sm text-foreground/80 leading-relaxed">{update.content}</p>
                      <p className="text-xs text-muted-foreground">
                        {mounted ? `Updated ${formatDistanceToNow(update.createdAt, { addSuffix: true })}` : "..."}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Stats */}
              {!prayer.isPrivate && (
                <div className="flex items-center space-x-6 text-sm text-muted-foreground">
                  <span>{prayer.prayerCount} praying</span>
                  <span>{prayer.encouragementCount} encouragements</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center flex-wrap gap-2">
                {prayer.status === "active" && (
                  <>
                    <Button
                      variant="outline"
                      size="default"
                      onClick={() => handleStatusChange(prayer.id, "answered")}
                      className="text-green-700 border-green-600/30 hover:bg-green-600/20 hover:border-green-600/50 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 transition-all duration-200 h-11 text-sm font-medium"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                      Mark Answered
                    </Button>
                    <Button
                      variant="outline"
                      size="default"
                      onClick={() => handleStatusChange(prayer.id, "archived")}
                      className="hover:bg-secondary/50 hover:border-accent/30 hover:text-foreground transition-all duration-200 h-11 text-sm font-medium"
                    >
                      <Archive className="w-4 h-4 mr-1" />
                      Archive
                    </Button>
                  </>
                )}
                {prayer.status === "answered" && (
                  <Button
                    variant="outline"
                    size="default"
                    onClick={() => handleStatusChange(prayer.id, "active")}
                    className="hover:bg-secondary/50 hover:border-accent/30 hover:text-foreground transition-all duration-200 h-11 text-sm font-medium"
                  >
                    <Circle className="w-4 h-4 mr-1" />
                    Reopen
                  </Button>
                )}
                {prayer.status === "archived" && (
                  <Button
                    variant="outline"
                    size="default"
                    onClick={() => handleStatusChange(prayer.id, "active")}
                    className="hover:bg-secondary/50 hover:border-accent/30 hover:text-foreground transition-all duration-200 h-11 text-sm font-medium"
                  >
                    <Circle className="w-4 h-4 mr-1" />
                    Restore
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  size="default"
                  className="hover:bg-secondary/50 hover:border-accent/30 hover:text-foreground transition-all duration-200 h-11 text-sm font-medium"
                >
                  Add Update
                </Button>
              </div>
            </Card>
          ))}
        </div>

        {/* Empty State */}
        {filteredPrayers.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">No prayers found</p>
            <p className="text-muted-foreground text-sm">Use the + button to create your first prayer</p>
          </div>
        )}

      </div>
    </div>
  );
}
