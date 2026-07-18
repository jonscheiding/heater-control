import { Button } from "./ui/Button.js";
import { IconCalendar } from "./ui/IconCalendar.js";

type Props = {
  onClick?: () => void;
};

export function CalendarButton({ onClick }: Props) {
  return (
    <Button round onClick={onClick} aria-label="Choose date/time to turn on">
      <IconCalendar />
    </Button>
  );
}
