import { useId, type ReactNode, type KeyboardEvent } from "react";
import { Button, Icon } from "@panasms/ui";
import { mdiMenuDown } from "@mdi/js";
import { t } from "./strings";

type Command = {
  label: string;
  icon: string;
  run: () => void;
  disabled?: boolean;
  pressed?: boolean;
};
type Group = { commands: Command[]; between?: ReactNode; primary?: boolean };

export function Toolbar({ groups }: { groups: Group[] }) {
  const id = useId();
  const commands = groups.flatMap((group) => group.commands);
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (
      !(event.target instanceof HTMLButtonElement) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled"),
    ).filter((button) => button.offsetWidth);
    const index = buttons.indexOf(event.target);
    if (index === -1) return;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % buttons.length
        : event.key === "ArrowLeft"
          ? (index + buttons.length - 1) % buttons.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    buttons[next].focus();
  }
  return (
    <div
      className="vw-tools"
      role="toolbar"
      onKeyDown={navigate}
      aria-label={t("tools")}
    >
      {groups
        .filter((group) => group.commands.length)
        .map((group, index) => (
          <div
            className={"vw-group" + (group.primary ? " vw-primary" : "")}
            key={index}
          >
            {group.commands.map((command, i) => (
              <span className="vw-item" key={command.icon}>
                {i === 1 && group.between}
                <Button
                  type="button"
                  className="vw-tool"
                  title={command.label}
                  aria-pressed={command.pressed}
                  disabled={command.disabled}
                  onClick={command.run}
                >
                  <Icon path={command.icon} size={20} />
                </Button>
              </span>
            ))}
          </div>
        ))}
      <label className="vw-mobile-tools" htmlFor={id}>
        {t("tools")} <Icon path={mdiMenuDown} size={18} />
        <select
          id={id}
          aria-label={t("tools")}
          value=""
          onChange={(event) => {
            const index = event.target.value;
            if (index !== "") commands[Number(index)].run();
          }}
        >
          <option value="" disabled>
            {t("tools")}
          </option>
          {commands.map((command, index) => (
            <option
              key={command.icon}
              value={index}
              disabled={command.disabled}
            >
              {command.pressed ? "✓ " : ""}
              {command.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
