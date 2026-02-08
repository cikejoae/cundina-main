interface LevelBadgeProps {
  level: number;
  name: string;
  className?: string;
}

export const LevelBadge = ({ level, name, className = "" }: LevelBadgeProps) => {
  const colors = [
    "from-cyan-500 to-blue-500",
    "from-blue-500 to-indigo-500", 
    "from-indigo-500 to-violet-500",
    "from-violet-500 to-purple-500",
    "from-purple-500 to-fuchsia-500",
    "from-fuchsia-500 to-pink-500",
    "from-yellow-500 to-orange-500"
  ];

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r ${colors[level - 1]} text-white font-medium text-sm ${className}`}>
      <span className="text-xs opacity-80">Nivel {level}</span>
      <span>{name}</span>
    </div>
  );
};
