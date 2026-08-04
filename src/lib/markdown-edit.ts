// Pure text-manipulation helpers behind BodyEditor's toolbar and keyboard
// handling. Nothing here touches React or the DOM: each function maps
// (value, selection) to the replacement text and selection, so the edge cases
// (toggling markers off, list continuation) are testable in isolation.

export interface EditResult {
    text: string;
    selStart: number;
    selEnd: number;
}

/**
 * Wrap the selection in a symmetric marker (**, *, `), or unwrap it when it
 * is already wrapped, so pressing the button twice is a no-op. "Already
 * wrapped" covers both shapes the selection can take: the markers inside the
 * selection (**text** selected whole) and just outside it (text selected
 * within **text**, which is what wrapping leaves selected). With no
 * selection, the fallback text is inserted wrapped and left selected.
 */
export function toggleWrap(value: string, start: number, end: number, marker: string, fallback: string): EditResult {
    const selected = value.slice(start, end);

    if (selected.length >= 2 * marker.length
        && selected.startsWith(marker) && selected.endsWith(marker)) {
        const inner = selected.slice(marker.length, selected.length - marker.length);
        return {
            text: value.slice(0, start) + inner + value.slice(end),
            selStart: start,
            selEnd: start + inner.length,
        };
    }

    // The boundary check stops the inner text of **bold** reading the second
    // asterisk as an italic wrapper: italic there nests (***bold italic***)
    // rather than eating one marker pair.
    if (start >= marker.length
        && value.slice(start - marker.length, start) === marker
        && value.slice(end, end + marker.length) === marker
        && value[start - marker.length - 1] !== marker[0]
        && value[end + marker.length] !== marker[marker.length - 1]) {
        return {
            text: value.slice(0, start - marker.length) + selected + value.slice(end + marker.length),
            selStart: start - marker.length,
            selEnd: start - marker.length + selected.length,
        };
    }

    const text = selected || fallback;
    return {
        text: value.slice(0, start) + marker + text + marker + value.slice(end),
        selStart: start + marker.length,
        selEnd: start + marker.length + text.length,
    };
}

/**
 * Prefix every line touched by the selection (list and quote markers), or
 * strip the prefix when every line already carries it. The marker is a
 * function of the line index so ordered lists can count. With no selection
 * the caret ends up after the inserted marker rather than selecting it, so
 * typing continues the line instead of replacing the marker.
 */
export function togglePrefix(value: string, start: number, end: number, prefix: (i: number) => string, matcher: RegExp): EditResult {
    const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;

    if (start === end) {
        const lineEndIdx = value.indexOf('\n', lineStart);
        const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
        const line = value.slice(lineStart, lineEnd);
        const m = line.match(matcher);
        if (m) {
            const pos = Math.max(lineStart, start - m[0].length);
            return {
                text: value.slice(0, lineStart) + line.slice(m[0].length) + value.slice(lineEnd),
                selStart: pos,
                selEnd: pos,
            };
        }
        const marker = prefix(0);
        return {
            text: value.slice(0, lineStart) + marker + value.slice(lineStart),
            selStart: start + marker.length,
            selEnd: start + marker.length,
        };
    }

    const block = value.slice(lineStart, end);
    const lines = block.split('\n');
    const changed = lines.every(l => matcher.test(l))
        ? lines.map(l => l.replace(matcher, '')).join('\n')
        : lines.map((l, i) => prefix(i) + l).join('\n');
    return {
        text: value.slice(0, lineStart) + changed + value.slice(end),
        selStart: lineStart,
        selEnd: lineStart + changed.length,
    };
}

const LIST_ITEM = /^(\s*)(?:([-*+])|(\d+)([.)]))( +)/;

/**
 * The Enter-key behaviour of a list: a newline inside a non-empty item
 * starts the next item (numbered items count up); Enter on an empty item
 * ends the list by removing its marker. Returns null when the caret is not
 * in a list item (or still inside its marker), letting the key fall through
 * to the default newline.
 */
export function continueList(value: string, caret: number): EditResult | null {
    const lineStart = caret === 0 ? 0 : value.lastIndexOf('\n', caret - 1) + 1;
    const lineEndIdx = value.indexOf('\n', lineStart);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const line = value.slice(lineStart, lineEnd);
    const m = line.match(LIST_ITEM);
    if (!m || caret < lineStart + m[0].length) return null;

    if (!line.slice(m[0].length).trim()) {
        // Empty item: second Enter ends the list.
        const pos = caret - m[0].length;
        return {
            text: value.slice(0, lineStart) + value.slice(lineStart + m[0].length),
            selStart: pos,
            selEnd: pos,
        };
    }

    const marker = m[2] !== undefined
        ? `${m[1]}${m[2]} `
        : `${m[1]}${Number(m[3]) + 1}${m[4]} `;
    const pos = caret + 1 + marker.length;
    return {
        text: `${value.slice(0, caret)}\n${marker}${value.slice(caret)}`,
        selStart: pos,
        selEnd: pos,
    };
}
