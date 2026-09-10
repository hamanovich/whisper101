export const longDashes = /[\u2010-\u2015\u2212]/g;
export const plainDashes = (text: string) => text.replace(longDashes, "-");
