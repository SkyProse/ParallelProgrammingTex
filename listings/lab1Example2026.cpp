// Integration adaptation: the 2021 assignment requires 100 repetitions.
#include <stdio.h>
#include <stdlib.h>
#include <sys/time.h>
int main(int argc, char* argv[])
{
    int i, N;
    struct timeval T1, T2;
    long delta_ms;
    N = atoi(argv[1]); /* N equals the first command-line parameter */
    gettimeofday(&T1, NULL); /* remember the current time T1 */
    for (i=0; i<100; i++) /* 100 experiments */
    {
        srand(i);  /* initialize the initial value of the RNG   */
        /* Fill the initial data array with size N */
        /* Complete the task, fill in the array with the results */
        /* Sort the array with the results by the specified method */
    }
    gettimeofday(&T2, NULL);   /* remember the current time T2 */
    delta_ms =  1000*(T2.tv_sec - T1.tv_sec) + (T2.tv_usec - T1.tv_usec)/1000;
    printf("\nN=%d. Milliseconds passed: %ld\n", N, delta_ms); /* T2 - T1 */
    return 0;
}
