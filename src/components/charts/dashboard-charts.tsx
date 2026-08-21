'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const PLATFORM_COLORS: Record<string, string> = {
  TIKTOK: '#0ea5e9',
  YOUTUBE_SHORTS: '#ef4444',
  INSTAGRAM_REELS: '#d946ef',
  SNAPCHAT_SPOTLIGHT: '#eab308',
};

const AXIS = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

const TOOLTIP_STYLE = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  fontSize: 12,
};

export function ViewsChart({ data }: { data: Array<{ date: string; views: number; likes: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Line
          type="monotone"
          dataKey="views"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={false}
          name="Vues"
        />
        <Line
          type="monotone"
          dataKey="likes"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth={1.5}
          dot={false}
          name="Likes"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PlatformChart({ data }: { data: Array<{ platform: string; views: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="platform"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: string) => value.split('_')[0] ?? value}
        />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'hsl(var(--muted))' }} />
        <Bar dataKey="views" name="Vues" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.platform} fill={PLATFORM_COLORS[entry.platform] ?? '#64748b'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
