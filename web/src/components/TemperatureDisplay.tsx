interface Props {
  value: number | undefined;
  unit: string | undefined;
}

export function TemperatureDisplay({ value, unit }: Props) {
  if (value === undefined) return <p className="temp">—</p>;
  return (
    <p className="temp">
      {value}°{unit ?? ""}
    </p>
  );
}
