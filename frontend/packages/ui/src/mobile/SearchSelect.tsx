import type { SearchSelectProps } from "@clientbridge/app-core";

import type { NativeProps } from "./props";
import { SelectSheet } from "./Select";

export function SearchSelect<K extends string>(props: NativeProps<SearchSelectProps<K>>) {
    return <SelectSheet {...props} searchFirst />;
}
