"use client";

type VestingProgressBarProps = {
  startTime: bigint;
  cliffDuration: bigint;
  vestingDuration: bigint;
  vestedAmount: bigint;
  totalAmount: bigint;
};

export const VestingProgressBar = ({
  startTime,
  cliffDuration,
  vestingDuration,
  vestedAmount,
  totalAmount,
}: VestingProgressBarProps) => {
  const vestingEnd = startTime + vestingDuration;

  const totalDuration = Number(vestingDuration);
  const cliffPercent = (Number(cliffDuration) / totalDuration) * 100;

  const vestedPercent = totalAmount > 0n ? (Number(vestedAmount) / Number(totalAmount)) * 100 : 0;

  return (
    <div className="w-full mt-4">
      <div className="flex justify-between text-xs mb-1">
        <span>Start</span>
        <span>Cliff ({cliffPercent.toFixed(0)}%)</span>
        <span>End</span>
      </div>

      <div className="relative w-full h-4 bg-base-300 rounded-full overflow-hidden">
        <div
          className="absolute h-full bg-primary transition-all duration-500"
          style={{ width: `${vestedPercent}%` }}
        />
        <div className="absolute h-full w-0.5 bg-warning" style={{ left: `${cliffPercent}%` }} />
      </div>

      <div className="flex justify-between text-xs mt-1 text-base-content/70">
        <span>{new Date(Number(startTime) * 1000).toLocaleDateString()}</span>
        <span>{vestedPercent.toFixed(1)}% vested</span>
        <span>{new Date(Number(vestingEnd) * 1000).toLocaleDateString()}</span>
      </div>
    </div>
  );
};
