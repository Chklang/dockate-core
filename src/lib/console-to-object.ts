export function textToObject<T>(columns: string[], input: string): T[] {
    const result: T[] = [];
    const columnsSize: Array<{from: number, to: number}> = new Array(columns.length);
    input.split("\n").forEach((line: string, index: number) => {
        if (index === 0) {
            // Header
            columns.forEach((columnName, indexColumn) => {
                columnsSize[indexColumn] = {
                    from: line.indexOf(columnName),
                    to: null,
                };
                if (indexColumn > 0) {
                    columnsSize[indexColumn - 1].to = columnsSize[indexColumn].from - 1;
                }
            });
        } else {
            const lineParsed: any = {};
            columns.forEach((columnName, indexColumn) => {
                if (columnsSize[indexColumn].to !== null) {
                    const text: string = line.substr(columnsSize[indexColumn].from, columnsSize[indexColumn].to - columnsSize[indexColumn].from);
                    lineParsed[columnName] = text.trim();
                } else {
                    const text: string = line.substr(columnsSize[indexColumn].from);
                    lineParsed[columnName] = text.trim();
                }
            });
            result.push(lineParsed);
        }
    });
    return result;
}
