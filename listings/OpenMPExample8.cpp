int i, j, sum[3], tmp[5];
#pragma omp parallel for private(tmp)                      /* !error! */
for (i = 0; i < 3; ++i) {
	for (j = 1; j <= 5; ++j) {
                tmp[j] = pow(j, i);                                     /* !error! */
				sum[i] = calculate_sum(tmp, 5);
           } 
}