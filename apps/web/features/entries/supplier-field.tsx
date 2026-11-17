"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";

export type SupplierChoice =
  | { kind: "none" }
  | { kind: "id"; id: string; name: string }
  | { kind: "new"; name: string };

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

type Option = { key: string; label: string; choice: SupplierChoice };

/**
 * Fornecedor: busca entre os cadastrados ou "usar 'X' como novo fornecedor" (RF23, RF12.R7).
 * O nome novo é associado ou criado pela API.
 */
export function SupplierField({
  id,
  suppliers,
  value,
  onChange,
}: {
  id: string;
  suppliers: readonly { id: string; name: string }[];
  value: SupplierChoice;
  onChange: (choice: SupplierChoice) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState(value.kind === "none" ? "" : value.name);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const needle = normalize(query);
  const options: Option[] = [];
  if (needle !== "") {
    for (const supplier of suppliers) {
      if (normalize(supplier.name).includes(needle)) {
        options.push({
          key: supplier.id,
          label: supplier.name,
          choice: { kind: "id", id: supplier.id, name: supplier.name },
        });
      }
    }
    const exact = suppliers.some((supplier) => normalize(supplier.name) === needle);
    if (!exact) {
      const name = query.trim();
      options.push({
        key: "new",
        label: `Usar “${name}” como novo fornecedor`,
        choice: { kind: "new", name },
      });
    }
  }
  const showList = open && options.length > 0;

  function choose(option: Option) {
    onChange(option.choice);
    setQuery(option.choice.kind === "none" ? "" : option.choice.name);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          const text = event.target.value;
          setQuery(text);
          setActive(0);
          setOpen(true);
          if (text.trim() === "") onChange({ kind: "none" });
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && showList) {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, options.length - 1));
          } else if (event.key === "ArrowUp" && showList) {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && showList) {
            event.preventDefault();
            const option = options[active];
            if (option) choose(option);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showList && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-md"
        >
          {options.map((option, index) => (
            <div
              key={option.key}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className="cursor-pointer break-words rounded-md px-2 py-1.5 aria-selected:bg-accent"
              // mousedown, não click: o campo ainda tem o foco e a lista fecharia antes do clique.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
