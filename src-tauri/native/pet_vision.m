#import <AppKit/AppKit.h>
#import <CoreImage/CoreImage.h>
#import <CoreVideo/CoreVideo.h>
#import <Vision/Vision.h>

// 0 = success, 1 = unsupported OS, 2 = no subject, 3 = processing failure.
int code_light_macos_major_version(void) {
    return (int)[NSProcessInfo processInfo].operatingSystemVersion.majorVersion;
}

int code_light_remove_background(const char *input_path, const char *output_path) {
    @autoreleasepool {
        if (@available(macOS 14.0, *)) {
            NSString *input = [NSString stringWithUTF8String:input_path];
            NSString *output = [NSString stringWithUTF8String:output_path];
            if (!input || !output) return 3;

            NSData *data = [NSData dataWithContentsOfFile:input];
            if (!data) return 3;

            VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithData:data options:@{}];
            VNGenerateForegroundInstanceMaskRequest *request =
                [[VNGenerateForegroundInstanceMaskRequest alloc] init];
            NSError *error = nil;
            if (![handler performRequests:@[request] error:&error]) return 3;
            VNInstanceMaskObservation *observation = request.results.firstObject;
            if (!observation || observation.allInstances.count == 0) return 2;

            NSUInteger largest = NSNotFound;
            NSUInteger largest_count = 0;
            NSIndexSet *instances = observation.allInstances;
            for (NSUInteger instance = instances.firstIndex; instance != NSNotFound;
                 instance = [instances indexGreaterThanIndex:instance]) {
                NSIndexSet *single = [NSIndexSet indexSetWithIndex:instance];
                CVPixelBufferRef mask = [observation generateMaskForInstances:single error:&error];
                if (!mask) return 3;
                if (CVPixelBufferGetPixelFormatType(mask) != kCVPixelFormatType_OneComponent32Float ||
                    CVPixelBufferLockBaseAddress(mask, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) {
                    CVPixelBufferRelease(mask);
                    return 3;
                }
                NSUInteger count = 0;
                size_t width = CVPixelBufferGetWidth(mask);
                size_t height = CVPixelBufferGetHeight(mask);
                size_t stride = CVPixelBufferGetBytesPerRow(mask);
                const uint8_t *base = CVPixelBufferGetBaseAddress(mask);
                for (size_t y = 0; y < height; y++) {
                    const float *row = (const float *)(base + y * stride);
                    for (size_t x = 0; x < width; x++) {
                        if (row[x] > 0.5f) count++;
                    }
                }
                CVPixelBufferUnlockBaseAddress(mask, kCVPixelBufferLock_ReadOnly);
                CVPixelBufferRelease(mask);
                if (count > largest_count) {
                    largest_count = count;
                    largest = instance;
                }
            }
            if (largest == NSNotFound || largest_count == 0) return 2;

            NSIndexSet *chosen = [NSIndexSet indexSetWithIndex:largest];
            CVPixelBufferRef masked =
                [observation generateMaskedImageOfInstances:chosen
                                         fromRequestHandler:handler
                                   croppedToInstancesExtent:NO
                                                      error:&error];
            if (!masked) return 3;

            CIImage *ci_image = [CIImage imageWithCVPixelBuffer:masked];
            CIContext *context = [CIContext contextWithOptions:@{}];
            CGColorSpaceRef color_space = CGColorSpaceCreateDeviceRGB();
            CGImageRef cg_image = [context createCGImage:ci_image
                                               fromRect:ci_image.extent
                                                 format:kCIFormatRGBA8
                                             colorSpace:color_space];
            CGColorSpaceRelease(color_space);
            CVPixelBufferRelease(masked);
            if (!cg_image) return 3;

            NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:cg_image];
            CGImageRelease(cg_image);
            NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
            if (!png || ![png writeToFile:output atomically:YES]) return 3;
            return 0;
        }
        return 1;
    }
}
