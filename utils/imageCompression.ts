export const compressImage = async (file: File, maxMB: number = 1): Promise<File> => {
    if (!file.type.startsWith('image/')) {
        return file;
    }

    const maxBytes = maxMB * 1024 * 1024;
    if (file.size <= maxBytes) {
        return file;
    }

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Max dimensions to prevent huge canvases
                const MAX_WIDTH = 2048;
                const MAX_HEIGHT = 2048;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(file);
                    return;
                }
                
                ctx.drawImage(img, 0, 0, width, height);
                
                let quality = 0.9;
                const compress = () => {
                    canvas.toBlob((blob) => {
                        if (!blob) {
                            resolve(file);
                            return;
                        }
                        if (blob.size > maxBytes && quality > 0.1) {
                            quality -= 0.1;
                            compress();
                        } else {
                            const compressedFile = new File([blob], file.name, {
                                type: 'image/jpeg',
                                lastModified: Date.now(),
                            });
                            resolve(compressedFile);
                        }
                    }, 'image/jpeg', quality);
                };
                compress();
            };
            img.onerror = () => resolve(file);
        };
        reader.onerror = () => resolve(file);
    });
};
